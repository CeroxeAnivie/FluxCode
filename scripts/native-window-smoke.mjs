import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const executable = resolve(root, 'src-tauri/target/debug/fluxcode.exe');
const data = resolve(root, 'work', `native-window-${Date.now()}`);
const statePath = resolve(data, 'window-state.json');
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  return port;
}

async function launch() {
  const port = await freePort();
  const argumentsForWebview = [
    `--remote-debugging-port=${port}`,
    ...(proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>'] : []),
  ].join(' ');
  const child = spawn(executable, [], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      FLUXCODE_TEST_DATA_DIR: data,
      WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: argumentsForWebview,
      ...(proxy
        ? {
            HTTP_PROXY: proxy,
            HTTPS_PROXY: proxy,
            ALL_PROXY: proxy,
            NO_PROXY: '127.0.0.1,localhost',
          }
        : {}),
    },
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error(`Desktop exited with ${child.exitCode}`);
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const page = browser.contexts()[0]?.pages()[0];
        if (page) {
          page.setDefaultTimeout(20000);
          await page.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
          return { child, browser, page };
        }
        await browser.close();
      } catch {
        await browser?.close().catch(() => {});
        browser = undefined;
        await new Promise((done) => setTimeout(done, 500));
      }
    }
    throw new Error('Desktop WebView2 CDP endpoint did not become ready');
  } catch (error) {
    child.kill();
    await browser?.close().catch(() => {});
    throw error;
  }
}

function windowRect(pid, moved) {
  const operation = moved
    ? `if (-not [FluxCodeWindow]::MoveWindow($handle, ${moved.x}, ${moved.y}, ${moved.width}, ${moved.height}, $true)) { throw 'MoveWindow failed' }`
    : '';
  const script = `
    $ErrorActionPreference = 'Stop'
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FluxCodeWindow {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool MoveWindow(IntPtr handle, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);
}
'@
    if ([FluxCodeWindow]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) -eq [IntPtr]::Zero) { throw 'Cannot enable per-monitor DPI awareness' }
    $handle = (Get-Process -Id ${pid}).MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) { throw 'Main window not found' }
    ${operation}
    $rect = [FluxCodeWindow+RECT]::new()
    if (-not [FluxCodeWindow]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect failed' }
    @{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 20000,
  });
  if (result.status !== 0) throw new Error(`Windows window query failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

async function close(instance) {
  const exited = new Promise((resolveExit, rejectExit) => {
    if (instance.child.exitCode !== null) return resolveExit(instance.child.exitCode);
    instance.child.once('exit', (code) => resolveExit(code));
    instance.child.once('error', rejectExit);
  });
  await instance.page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  let timeout;
  const code = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Desktop did not exit')), 20000);
    }),
  ]).finally(() => clearTimeout(timeout));
  assert.equal(code, 0);
  await instance.browser.close();
}

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 16, `${label}: ${actual} differs from ${expected}`);
}

await mkdir(data, { recursive: true });
let instance;
try {
  instance = await launch();
  const monitor = await instance.page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|primary_monitor'),
  );
  assert.ok(monitor?.workArea, 'Primary monitor work area must be available');
  const workArea = monitor.workArea;
  const initial = windowRect(instance.child.pid);
  const desired = { x: 64, y: 72, width: 1100, height: 720 };
  const positioned = windowRect(instance.child.pid, desired);
  assert.notDeepEqual(positioned, initial, 'Window must move or resize for the persistence test');
  await new Promise((done) => setTimeout(done, 500));
  await close(instance);
  instance = undefined;
  const saved = JSON.parse(await readFile(statePath, 'utf8')).main;
  assert.equal(saved.maximized, false);
  near(saved.x, positioned.x, 'saved x');
  near(saved.y, positioned.y, 'saved y');
  assert.ok(saved.width > 0 && Math.abs(saved.width - positioned.width) <= 32);
  assert.ok(saved.height > 0 && Math.abs(saved.height - positioned.height) <= 32);

  instance = await launch();
  await new Promise((done) => setTimeout(done, 500));
  const restored = windowRect(instance.child.pid);
  for (const field of ['x', 'y', 'width', 'height'])
    near(restored[field], positioned[field], field);
  await instance.page.getByRole('button', { name: '最大化', exact: true }).click();
  await instance.page.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
  await close(instance);
  instance = undefined;
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).main.maximized, true);

  instance = await launch();
  await instance.page.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
  await close(instance);
  instance = undefined;

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.main.maximized = false;
  state.main.x = workArea.position.x + workArea.size.width - 80;
  state.main.y = workArea.position.y + workArea.size.height - 80;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  instance = await launch();
  await new Promise((done) => setTimeout(done, 500));
  const recovered = windowRect(instance.child.pid);
  assert.ok(recovered.x >= workArea.position.x);
  assert.ok(recovered.y >= workArea.position.y);
  assert.ok(recovered.x + recovered.width <= workArea.position.x + workArea.size.width + 16);
  assert.ok(recovered.y + recovered.height <= workArea.position.y + workArea.size.height + 16);
  await close(instance);
  instance = undefined;

  console.log(
    'Native Windows window size, position, maximize, and partial off-screen recovery passed.',
  );
  console.log(`Primary monitor scale: ${monitor.scaleFactor}`);
  console.log(`Isolated data: ${data}`);
} finally {
  if (instance) {
    instance.child.kill();
    await instance.browser.close().catch(() => {});
  }
}

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-startup-${Date.now()}`);
await mkdir(data, { recursive: true });
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const env = {
  ...process.env,
  FLUXCODE_TEST_DATA_DIR: data,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
    '--remote-debugging-port=0',
    ...(proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>'] : []),
  ].join(' '),
};
delete env.WEBVIEW2_USER_DATA_FOLDER;
const started = performance.now();
const child = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
  env,
  windowsHide: true,
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 60 && !browser; attempt++) {
    const files = await readdir(resolve(data, 'webview'), { recursive: true }).catch(() => []);
    for (const file of files.filter((name) => name.endsWith('DevToolsActivePort'))) {
      const port = (await readFile(resolve(data, 'webview', file), 'utf8')).split(/\r?\n/)[0];
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (browser) break;
    }
    if (!browser) await new Promise((done) => setTimeout(done, 250));
  }
  assert.ok(browser, 'Native browser must start');
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
  const firstReadyMs = performance.now() - started;
  const samples = [];
  for (let index = 0; index < 3; index++) {
    const start = performance.now();
    await page.reload();
    await page.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
    await page.getByRole('textbox', { name: '任务描述' }).waitFor();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    samples.push(Math.round((performance.now() - start) * 10) / 10);
  }
  const report = {
    firstReadyMs: Math.round(firstReadyMs * 10) / 10,
    reloadThroughTwoFramesMs: samples,
    scope:
      'Fresh isolated native WebView2 profile; initial process-to-ready includes CDP discovery polling. Reload samples include configuration and UI-state recovery but not process or engine startup.',
  };
  await writeFile(resolve(data, 'result.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ data, ...report }, null, 2));
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect.poll(() => child.exitCode).toBe(0);
} finally {
  if (child.exitCode === null)
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  await browser?.close().catch(() => {});
}

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', 'native-terminal-' + Date.now());
await mkdir(data, { recursive: true });
const less =
  process.env.FLUXCODE_LESS_BIN ||
  resolve(process.env.ProgramFiles || 'C:/Program Files', 'Git/usr/bin/less.exe');
await access(less);
await writeFile(
  resolve(data, 'pager.txt'),
  Array.from({ length: 150 }, (_, i) => 'PAGER_ROW_' + i).join('\n'),
  'utf8',
);
await writeFile(
  resolve(data, 'descendant.py'),
  [
    'import subprocess, sys, pathlib, time',
    'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])',
    'pathlib.Path("descendant.pid").write_text(str(child.pid), encoding="utf-8")',
    'print("DESCENDANT_READY", flush=True)',
    'time.sleep(120)',
  ].join('\n'),
  'utf8',
);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const env = {
  ...process.env,
  FLUXCODE_TEST_DATA_DIR: data,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
    '--remote-debugging-port=0',
    ...(proxy ? ['--proxy-server=' + proxy, '--proxy-bypass-list=<-loopback>'] : []),
  ].join(' '),
};
delete env.WEBVIEW2_USER_DATA_FOLDER;
const child = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
  env,
  windowsHide: true,
  stdio: 'ignore',
});
const checks = [];
let browser;
try {
  for (let attempt = 0; attempt < 60 && !browser; attempt++) {
    const files = await readdir(resolve(data, 'webview'), { recursive: true }).catch(() => []);
    for (const file of files.filter((name) => name.endsWith('DevToolsActivePort'))) {
      const port = (await readFile(resolve(data, 'webview', file), 'utf8')).split(/\r?\n/)[0];
      browser = await chromium.connectOverCDP('http://127.0.0.1:' + port).catch(() => null);
      if (browser) break;
    }
    if (!browser) await new Promise((done) => setTimeout(done, 250));
  }
  assert.ok(browser, 'Native WebView must start');
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(20000);
  await page.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
  await page.evaluate(async (path) => {
    const ipc = window.__TAURI_INTERNALS__.invoke;
    const snapshot = await ipc('load_ui_state');
    await ipc('save_ui_state', {
      expectedGeneration: snapshot?.generation ?? null,
      values: {
        ...(snapshot?.values ?? {}),
        'fluxcode.catalog.v1': JSON.stringify({
          version: 1,
          projects: [{ id: 'terminal', name: '终端验收', path }],
          tasks: [],
        }),
      },
    });
    const settings = await ipc('load_settings');
    await ipc('connect_engine', {
      settings: { ...settings, baseUrl: 'http://127.0.0.1:9/v1', model: 'terminal-local-only' },
      apiKey: 'fixture-local-only',
      rememberKey: false,
    });
  }, data);
  await page.reload();
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  const screen = page.locator('.xterm-accessibility');
  const input = page.locator('.xterm-helper-textarea');
  await expect(screen).toContainText('PS ');
  async function command(text) {
    await input.focus();
    await input.evaluate((element, value) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', value);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }));
    }, text);
    await page.keyboard.press('Enter');
  }
  async function shellPrompt() {
    await expect.poll(async () => (await screen.innerText()).trim()).toMatch(/PS [^\r\n>]+>\s*$/);
  }
  await command("$fluxMarker='持久会话'; Write-Output ('UTF8_' + '中文完成')");
  await expect(screen).toContainText('UTF8_中文完成');
  checks.push('PowerShell UTF-8/CJK input and output');
  await command('python -q');
  await expect(screen).toContainText('>>>');
  await command("print('PY_REPL_' + str(6 * 7))");
  await expect(screen).toContainText('PY_REPL_42');
  await command('exit()');
  await shellPrompt();
  await command("Write-Output ('SHELL_' + 'RECOVERED')");
  await expect(screen).toContainText('SHELL_RECOVERED');
  checks.push('Python interactive REPL returns to shell');
  await command("Write-Output ('INTERRUPT_' + 'READY'); Start-Sleep -Seconds 120");
  await expect(screen).toContainText('INTERRUPT_READY');
  await input.press('Control+c');
  await shellPrompt();
  await command("Write-Output ('CTRL_C_' + 'RECOVERED')");
  await expect(screen).toContainText('CTRL_C_RECOVERED');
  checks.push('Ctrl+C interrupts foreground command and preserves shell');
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await command("Write-Output ('SESSION_' + $fluxMarker)");
  await expect(screen).toContainText('SESSION_持久会话');
  checks.push('Dock hide/reopen preserves shell variables');
  await command("Write-Output ('WIDTH_A_' + [Console]::WindowWidth)");
  await expect(screen).toContainText(/WIDTH_A_\d+/);
  const widthA = Number((await screen.innerText()).match(/WIDTH_A_(\d+)/)?.[1]);
  const initialScreenWidth = (await page.locator('.terminal-screen').boundingBox()).width;
  await page.getByRole('button', { name: '最大化', exact: true }).click();
  await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
  await expect
    .poll(async () => (await page.locator('.terminal-screen').boundingBox()).width)
    .toBeGreaterThan(initialScreenWidth);
  await command("Write-Output ('WIDTH_B_' + [Console]::WindowWidth)");
  await expect(screen).toContainText(/WIDTH_B_\d+/);
  const widthB = Number((await screen.innerText()).match(/WIDTH_B_(\d+)/)?.[1]);
  assert.ok(
    widthA > 0 && widthB > widthA,
    'Native resize must reach ConPTY: ' + widthA + ' -> ' + widthB,
  );
  checks.push('Native window resize reaches console dimensions');
  await page.getByRole('button', { name: '还原窗口', exact: true }).click();
  await command("git --no-pager -C '" + root.replaceAll("'", "''") + "' log --oneline -5");
  await expect(screen).toContainText(/[0-9a-f]{7}/);
  await shellPrompt();
  await command("Write-Output ('PAGER_' + 'RECOVERED')");
  await expect(screen).toContainText('PAGER_RECOVERED');
  checks.push('Git terminal output and command recovery');
  await shellPrompt();
  await command("& '" + less.replaceAll("'", "''") + "' -+F pager.txt");
  await expect(screen).toContainText('PAGER_ROW_0');
  await input.press('G');
  await expect(screen).toContainText('PAGER_ROW_149');
  await input.press('q');
  await shellPrompt();
  await command("Write-Output ('FULLSCREEN_' + 'RECOVERED')");
  await expect(screen).toContainText('FULLSCREEN_RECOVERED');
  checks.push('less full-screen paging, navigation and alternate-buffer recovery');
  await page.getByRole('button', { name: '重启终端', exact: true }).click();
  await expect(screen).toContainText('PS ');
  await command("Write-Output ('RESTART_' + 'READY')");
  await expect(screen).toContainText('RESTART_READY');
  checks.push('Explicit terminal restart opens a usable shell');
  await shellPrompt();
  await command('python descendant.py');
  await expect(screen).toContainText('DESCENDANT_READY');
  const descendantPid = Number(await readFile(resolve(data, 'descendant.pid'), 'utf8'));
  const exists = () => {
    try {
      process.kill(descendantPid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  assert.ok(exists(), 'Descendant must be running before session termination');
  await page.getByRole('button', { name: '结束终端会话 终端验收', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.__TAURI_INTERNALS__.invoke('runtime_resource_usage')).windowResources
            .terminalSessions,
      ),
    )
    .toBe(0);
  await expect.poll(exists).toBe(false);
  checks.push('Ending terminal session releases PTY and terminates Python descendant');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect.poll(() => child.exitCode, { timeout: 15000 }).toBe(0);
  checks.push('Application exits normally after sessions end');
} finally {
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ checks }, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ data, checks }, null, 2));
  if (child.exitCode === null)
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  await browser?.close().catch(() => {});
}

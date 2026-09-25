import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-theme-${Date.now()}`);
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
  const nativeTheme = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|theme'),
  );
  assert.ok(['dark', 'light'].includes(nativeTheme));
  await expect(page.locator('html')).toHaveAttribute('data-theme', nativeTheme);
  await page.emulateMedia({ colorScheme: nativeTheme === 'dark' ? 'light' : 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', nativeTheme);
  for (const theme of ['light', 'dark', 'system']) {
    await page.evaluate(
      (theme) =>
        window.__TAURI_INTERNALS__.invoke('save_appearance', {
          appearance: { language: 'zh-CN', theme },
          migrate: false,
        }),
      theme,
    );
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      theme === 'system' ? nativeTheme : theme,
    );
  }
  await page.reload();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme', nativeTheme);
  await page.screenshot({ path: resolve(data, 'system-theme.png') });
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect.poll(() => child.exitCode).toBe(0);
  console.log(
    JSON.stringify({
      result: 'passed',
      nativeTheme,
      data,
      coverage: [
        'native system theme',
        'browser preference mismatch',
        'explicit override',
        'reload',
      ],
    }),
  );
} finally {
  if (child.exitCode === null)
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  await browser?.close().catch(() => {});
}

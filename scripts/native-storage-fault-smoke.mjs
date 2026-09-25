import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-storage-fault-${Date.now()}`);
const mirror = resolve(data, 'ui-state-mirror.json');
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const fault = process.argv.includes('--permission-denied') ? 'permission-denied' : 'read-only';
const draft = `${fault === 'read-only' ? '只读目录' : '权限不足'}下不能丢失的草稿`;
const sid =
  fault === 'permission-denied'
    ? spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
        ],
        { windowsHide: true, encoding: 'utf8', timeout: 10000 },
      ).stdout.trim()
    : null;
if (sid) assert.match(sid, /^S-1-\d+(?:-\d+)+$/);
await mkdir(data, { recursive: true });
const probe = createServer();
await new Promise((done) => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const child = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    FLUXCODE_TEST_DATA_DIR: data,
    WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
      `--remote-debugging-port=${port}`,
      ...(proxy
        ? [`--proxy-server=${new URL(proxy).origin}`, '--proxy-bypass-list=<-loopback>']
        : []),
    ].join(' '),
  },
});
function readonly(enabled) {
  const args =
    fault === 'read-only'
      ? [enabled ? '+R' : '-R', mirror]
      : enabled
        ? [data, '/deny', `*${sid}:(WD,AD)`]
        : [data, '/remove:d', `*${sid}`];
  const result = spawnSync(fault === 'read-only' ? 'attrib.exe' : 'icacls.exe', args, {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
}
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Desktop exited: ${child.exitCode}`);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  assert.ok(browser);
  const page = browser.contexts()[0].pages()[0];
  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('原生故障注入之前');
  await expect
    .poll(async () => (await readFile(mirror, 'utf8')).includes('原生故障注入之前'))
    .toBe(true);
  const before = await readFile(mirror, 'utf8');
  readonly(true);
  await input.fill(draft);
  await expect(page.getByText('草稿仍保留在内存中，请重试保存或另存后再退出。')).toBeVisible();
  assert.equal(await readFile(mirror, 'utf8'), before);
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(input).toHaveValue(draft);
  assert.equal(child.exitCode, null);
  const exported = resolve(root, 'work', `recovered-${fault}-${Date.now()}.txt`);
  await page.evaluate(
    async ({ path, content }) => {
      await window.__TAURI_INTERNALS__.invoke('export_document', { path, content });
    },
    { path: exported, content: await input.inputValue() },
  );
  assert.equal(await readFile(exported, 'utf8'), draft);
  readonly(false);
  await page.getByRole('button', { name: '重试保存草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '另存全部草稿' })).toHaveCount(0);
  await expect.poll(async () => (await readFile(mirror, 'utf8')).includes(draft)).toBe(true);
  await page.reload();
  await expect(input).toHaveValue(draft);
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect.poll(() => child.exitCode).toBe(0);
  console.log(
    JSON.stringify(
      {
        passed: true,
        data,
        checks: [
          fault,
          'original retained',
          'close blocked',
          'alternate export',
          'retry',
          'reload',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  readonly(false);
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}

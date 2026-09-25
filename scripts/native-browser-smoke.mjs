import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-browser-${Date.now()}`);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
await mkdir(data, { recursive: true });
const fixture = createServer((req, res) => {
  if (req.url === '/redirect-internal') {
    res.writeHead(302, { location: 'http://tauri.localhost/index.html' }).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>浏览器本地验收</title>
    <style>body{font:16px system-ui;padding:36px;background:#edf4ff;color:#182742}a{display:block;margin:20px 0}</style>
    <h1>右侧网页 ${req.url === '/second' ? '第二页' : '第一页'}</h1>
    <p>这是真实 WebView2 内的本地测试页面。</p><a href="/second">下一页</a>
    <a href="/second" target="_blank">新窗口链接</a><a href="/redirect-internal">内部地址拦截</a>
    </html>`);
});
await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${fixture.address().port}/first`;
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
  assert.ok(browser, 'WebView2 debugging endpoint must start');
  const main = browser.contexts()[0].pages()[0];
  main.setDefaultTimeout(15000);
  await main.getByRole('button', { name: '打开浏览器', exact: true }).click();
  const address = main.getByRole('textbox', { name: '网页地址' });
  await address.fill(url);
  await address.press('Enter');
  let remote;
  await expect
    .poll(
      () => {
        remote = browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page !== main && page.url().startsWith('http://127.0.0.1:'));
        return !!remote;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await expect(remote.getByRole('heading')).toContainText('第一页');
  const views = await main.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:webview|get_all_webviews'),
  );
  assert.equal(views.length, 2);
  assert.deepEqual(
    views.map((view) => view.window_label),
    ['main', 'main'],
    'Both WebViews share one native window',
  );
  const denied = await remote.evaluate(async () => {
    const results = [];
    for (const command of ['load_settings', 'plugin:window|close', 'execute_terminal']) {
      try {
        await window.__TAURI_INTERNALS__.invoke(command, {});
        results.push(false);
      } catch {
        results.push(true);
      }
    }
    return results;
  });
  assert.deepEqual(
    denied,
    [true, true, true],
    'Remote WebView cannot invoke local or plugin commands',
  );
  await remote.getByRole('link', { name: '下一页', exact: true }).click();
  await expect(remote.getByRole('heading')).toContainText('第二页');
  await expect(address).toHaveValue(url.replace('/first', '/second'));
  await main.getByRole('button', { name: '后退', exact: true }).click();
  await expect(remote.getByRole('heading')).toContainText('第一页');
  const boundary = main.getByRole('separator', { name: '调整浏览器宽度' });
  const before = Number(await boundary.getAttribute('aria-valuenow'));
  await boundary.focus();
  await boundary.press('ArrowLeft');
  await expect(boundary).toHaveAttribute('aria-valuenow', String(before + 24));
  await expect.poll(() => remote.evaluate(() => innerWidth)).toBeGreaterThan(before);
  await main.getByRole('button', { name: '设置', exact: true }).click();
  await expect(main.getByRole('dialog')).toBeVisible();
  await main.keyboard.press('Escape');
  await remote.getByRole('link', { name: '新窗口链接', exact: true }).click();
  await expect(remote.getByRole('heading')).toContainText('第二页');
  assert.equal(
    browser.contexts().flatMap((context) => context.pages()).length,
    2,
    'Popup links reuse the same child',
  );
  await remote.getByRole('link', { name: '内部地址拦截', exact: true }).click();
  await expect(main.getByRole('alert')).toContainText('已阻止不安全的网页跳转');
  assert.ok(!remote.url().includes('tauri.localhost'));
  await main.screenshot({ path: resolve(data, 'browser-panel.png') });
  await main.getByRole('button', { name: '关闭浏览器', exact: true }).click();
  await expect(main.getByRole('button', { name: '打开浏览器', exact: true })).toBeFocused();
  await expect.poll(() => browser.contexts().flatMap((context) => context.pages()).length).toBe(1);
  await main.getByRole('button', { name: '关闭窗口', exact: true }).click();
  console.log(
    JSON.stringify(
      {
        passed: true,
        artifactDirectory: data,
        checks: [
          'child WebView',
          'IPC denial',
          'navigation',
          'history',
          'resize',
          'dialog',
          'popup reuse',
          'internal-origin denial',
          'close and focus',
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  const pages = browser?.contexts().flatMap((context) => context.pages()) ?? [];
  console.error(
    JSON.stringify(
      await Promise.all(
        pages.map(async (page) => ({
          url: page.url(),
          alerts: await page
            .getByRole('alert')
            .allTextContents()
            .catch(() => []),
          text: page.url().startsWith('chrome-error:')
            ? await page.locator('body').innerText()
            : '',
        })),
      ),
      null,
      2,
    ),
  );
  const main = pages.find((page) => page.url().includes('tauri.localhost'));
  if (main) {
    console.error(
      await main
        .evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:webview|get_all_webviews'))
        .catch(String),
    );
    await main.screenshot({ path: resolve(data, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  await new Promise((done) => fixture.close(done));
}

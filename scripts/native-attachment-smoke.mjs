import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, copyFile, cp, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const sourceExecutable = resolve(root, 'src-tauri/target/release/fluxcode.exe');
const releaseDirectory = resolve(root, 'src-tauri/target/release');
const fixture = resolve(root, 'work', `native-attachment-${Date.now()}`);
const executable = resolve(fixture, 'FluxCode.exe');
const data = resolve(fixture, 'data');
const image = resolve(data, 'sample.png');
const damaged = resolve(data, 'damaged.png');
const oversized = resolve(data, 'oversized.png');
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;

function pngDimensions(bytes) {
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function launch() {
  const port = await freePort();
  const webviewArguments = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    ...(proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>'] : []),
  ].join(' ');
  const child = spawn(executable, [], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webviewArguments,
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

async function invoke(page, command, args) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
}

async function rejection(page, command, args) {
  return page.evaluate(
    async ({ command, args }) => {
      try {
        await window.__TAURI_INTERNALS__.invoke(command, args);
        return null;
      } catch (error) {
        return String(error);
      }
    },
    { command, args },
  );
}

async function drop(page, paths) {
  await invoke(page, 'plugin:event|emit', {
    event: 'tauri://drag-drop',
    payload: { paths, position: { x: 10, y: 10 } },
  });
}

await access(sourceExecutable);
await mkdir(data, { recursive: true });
await copyFile(sourceExecutable, executable);
for (const resource of ['engine', 'legal']) {
  await cp(resolve(releaseDirectory, resource), resolve(fixture, resource), { recursive: true });
}
await copyFile(resolve(root, 'docs/images/desktop.png'), image);
await writeFile(damaged, 'invalid PNG bytes', 'utf8');
const file = await open(oversized, 'w');
try {
  await file.truncate(20 * 1024 * 1024 + 1);
} finally {
  await file.close();
}
assert.ok(pngDimensions(await readFile(image)).width > 320);

let desktop;
try {
  desktop = await launch();
  const { page } = desktop;
  await page.evaluate(() =>
    localStorage.setItem(
      'fluxcode.appearance.v1',
      JSON.stringify({ language: 'zh-CN', theme: 'system' }),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: '添加文件或图片' }).waitFor();

  assert.deepEqual(await invoke(page, 'inspect_dropped_paths', { paths: [image] }), [
    { path: image, kind: 'image' },
  ]);
  assert.match(
    await rejection(page, 'inspect_dropped_paths', { paths: [resolve(data, 'missing.png')] }),
    /无法读取拖入的文件或目录/,
  );
  assert.match(
    await rejection(page, 'inspect_dropped_paths', { paths: [oversized] }),
    /超过大小上限/,
  );
  assert.match(
    await rejection(page, 'inspect_dropped_paths', {
      paths: Array.from({ length: 21 }, () => image),
    }),
    /每次最多拖入 20 个/,
  );
  assert.deepEqual(await invoke(page, 'inspect_dropped_paths', { paths: [image, image] }), [
    { path: image, kind: 'image' },
  ]);

  const source = await invoke(page, 'preview_attachment', { path: image });
  assert.match(source, /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
  const preview = pngDimensions(Buffer.from(source.split(',')[1], 'base64'));
  assert.ok(preview.width <= 320 && preview.height <= 320);
  assert.ok(preview.width === 320 || preview.height === 320);
  assert.match(
    await rejection(page, 'preview_attachment', { path: damaged }),
    /图片内容与扩展名不匹配/,
  );
  assert.match(await rejection(page, 'preview_attachment', { path: oversized }), /20 MiB/);

  await drop(page, [image]);
  await page.locator('.attachment-feedback').getByText('已添加 1 个附件').waitFor();
  const previewButton = page.getByRole('button', { name: '预览图片 sample.png' });
  await previewButton.click();
  const dialog = page.getByRole('dialog', { name: '预览图片 sample.png' });
  await dialog.getByRole('img', { name: 'sample.png' }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await previewButton.evaluate((element) => element === document.activeElement), true);

  await drop(page, [image.toUpperCase()]);
  await page.locator('.attachment-feedback').getByText('已跳过 1 个重复项').waitFor();
  assert.equal(await page.locator('.attachment-item').count(), 1);

  await drop(page, [damaged]);
  await page.getByRole('button', { name: '预览图片 damaged.png' }).click();
  const damagedDialog = page.getByRole('dialog', { name: '预览图片 damaged.png' });
  await damagedDialog
    .getByRole('alert')
    .getByText(/图片内容与扩展名不匹配/)
    .waitFor();
  await damagedDialog.getByRole('button', { name: '关闭图片预览' }).click();
  await drop(page, [oversized]);
  await page
    .getByRole('alert')
    .getByText(/超过大小上限/)
    .waitFor();
  assert.equal(await page.locator('.attachment-item').count(), 2);

  await page.getByRole('button', { name: '移除 sample.png' }).click();
  await page.getByRole('button', { name: '移除 damaged.png' }).click();
  assert.equal(await page.locator('.attachment-item').count(), 0);
  assert.deepEqual(
    JSON.parse(await page.evaluate(() => localStorage.getItem('fluxcode.attachments.v1')))[
      'new:null'
    ],
    [],
  );
  console.log(
    `PASS: native attachment inspection, thumbnail, drop, preview and feedback (${data})`,
  );
} catch (error) {
  if (desktop?.page) {
    console.error(
      (
        await desktop.page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(-3000),
    );
    await desktop.page
      .screenshot({ path: resolve(data, 'native-attachment-failure.png') })
      .catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await desktop?.browser?.close().catch(() => {});
  if (desktop?.child?.exitCode === null) desktop.child.kill();
}

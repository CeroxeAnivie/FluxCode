import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-${Date.now()}`);
await mkdir(data, { recursive: true });
const payloads = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url !== '/v1/responses') { res.writeHead(404).end(); return; }
  let bytes=Buffer.concat(chunks);
  if(req.headers['content-encoding']==='gzip') bytes=gunzipSync(bytes);
  if(req.headers['content-encoding']==='zstd') bytes=zstdDecompressSync(bytes);
  payloads.push(JSON.parse(bytes.toString('utf8')));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const text = 'Native desktop integration passed.';
  const item = { id: 'native-msg', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  const event = (type, rest) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`);
  event('response.created', { response: { id: 'native-response', status: 'in_progress', output: [] } });
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
  event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { id: 'native-response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
  res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
  windowsHide: true,
  env: {
    ...process.env,
    FLUXCODE_TEST_DATA_DIR: data,
    WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9226 --proxy-server=http://127.0.0.1:14455/ --proxy-bypass-list=<-loopback>',
    HTTP_PROXY: 'http://127.0.0.1:14455/', HTTPS_PROXY: 'http://127.0.0.1:14455/', ALL_PROXY: 'http://127.0.0.1:14455/',
  },
  stdio: 'ignore',
});
let browser;
let page;
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9226'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(browser, 'WebView2 debugging endpoint must start');
  for (let attempt = 0; attempt < 20; attempt++) {
    page = browser.contexts()[0]?.pages()[0];
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, 'Native WebView page must exist');
  page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: '让想法，在代码中发生。' }).waitFor();
  await page.screenshot({ path: resolve(root, 'work/native-welcome.png') });
  await page.evaluate(path => localStorage.setItem('fluxcode.catalog.v1', JSON.stringify({ version: 1, projects: [{ id: 'native-project', name: 'FluxCode', path }], tasks: [] })), root);
  await page.reload();
  await page.getByRole('button', {name:'README.md', exact:true}).waitFor();
  await page.screenshot({ path: resolve(root, 'docs/images/desktop.png') });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill(`http://127.0.0.1:${server.address().port}/v1`);
  await page.getByLabel('模型 ID', { exact: true }).fill('native-fixture');
  await page.getByLabel('API Key 环境变量', { exact: true }).fill('FLUX_NATIVE_FIXTURE_KEY');
  await page.locator('input[type=password]').fill('fixture-only-not-a-secret');
  await page.getByRole('button', { name: '保存并连接' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('textbox', { name: '任务描述' }).fill('请确认桌面应用的消息通路。');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByText('Native desktop integration passed.', { exact: true }).waitFor();
  assert.equal(payloads.at(-1).reasoning?.effort, undefined);
  await page.getByRole('combobox', {name:'推理强度'}).selectOption('high');
  await page.getByRole('textbox', {name:'任务描述'}).fill('确认当前会话的推理强度。');
  await page.getByRole('button', {name:'发送任务'}).click();
  await page.getByRole('button', {name:'停止任务'}).waitFor({state:'hidden'});
  assert.equal(payloads.at(-1).reasoning?.effort, 'high');
  await page.getByRole('button', { name: '切换终端' }).click();
  await page.getByRole('textbox', { name: '终端命令' }).fill("Write-Output 'native-terminal-ok'");
  await page.getByRole('button', { name: '执行命令' }).click();
  await page.waitForFunction(() => document.querySelector('.terminal-output')?.textContent?.includes('[退出码 0]'));
  assert.match(await page.locator('.terminal-output').innerText(), /native-terminal-ok/);
  await page.screenshot({ path: resolve(root, 'work/native-workspace.png') });
  const config = await readFile(resolve(data, 'fluxcode.toml'), 'utf8');
  assert.match(config, /model = "native-fixture"/);
  assert.ok(!config.includes('fixture-only-not-a-secret'));
  assert.match(await readFile(resolve(data, 'engine-home/ENVIRONMENT.md'), 'utf8'), /Windows|windows/);
  assert.match(await readFile(resolve(data, 'engine-home/AGENTS.md'), 'utf8'), /User instructions/);
  await page.reload();
  await page.getByText('执行引擎已就绪', { exact: true }).waitFor();
  await page.getByRole('button', { name: '请确认桌面应用的消息通路。', exact: true }).click();
  await page.getByText('Native desktop integration passed.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', {name:'推理强度'}).inputValue(), 'high');
  await page.getByRole('combobox', {name:'推理强度'}).selectOption('off');
  await page.getByRole('textbox', {name:'任务描述'}).fill('恢复服务默认推理设置。');
  await page.getByRole('button', {name:'发送任务'}).click();
  await page.getByRole('button', {name:'停止任务'}).waitFor({state:'hidden'});
  assert.equal(payloads.at(-1).reasoning?.effort, undefined);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '删除已保存密钥' }).click();
  await page.getByText('已删除保存的密钥；当前运行中的连接不受影响。').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Native shutdown timed out')), 10000); if (child.exitCode !== null) { clearTimeout(timer); resolve(); } else child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  console.log('PASS: real Tauri/WebView2 GUI -> Rust IPC -> bundled engine -> local Responses; terminal, TOML, OS credential save/delete, reload/resume, shutdown.');
} catch (error) {
  if (page) {
    console.error((await page.locator('body').innerText().catch(() => '')).slice(-6000));
    await page.screenshot({ path: resolve(root, 'work/native-failure.png') }).catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

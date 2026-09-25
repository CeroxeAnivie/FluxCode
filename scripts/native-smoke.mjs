import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { verifyNativeChannels } from './lib/channel-acceptance.mjs';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-${Date.now()}`);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const proxyEnv = proxy
  ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: '', no_proxy: '' }
  : {};
const webviewArguments = [
  '--remote-debugging-port=9226',
  ...(proxy ? [`--proxy-server=${new URL(proxy).origin}`, '--proxy-bypass-list=<-loopback>'] : []),
].join(' ');
await mkdir(data, { recursive: true });
const payloads = [];
let fixtureModels = ['native-fixture'];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url === '/v1/models') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: fixtureModels.map((id) => ({ id })) }));
    return;
  }
  if (req.url !== '/v1/responses') {
    res.writeHead(404).end();
    return;
  }
  let bytes = Buffer.concat(chunks);
  if (req.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
  if (req.headers['content-encoding'] === 'zstd') bytes = zstdDecompressSync(bytes);
  payloads.push(JSON.parse(bytes.toString('utf8')));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const text = 'Native desktop integration passed.';
  const item = {
    id: 'native-msg',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  const event = (type, rest) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`);
  event('response.created', {
    response: { id: 'native-response', status: 'in_progress', output: [] },
  });
  event('response.output_item.added', {
    output_index: 0,
    item: { ...item, status: 'in_progress', content: [] },
  });
  event('response.output_text.delta', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: text,
  });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', {
    response: {
      id: 'native-response',
      status: 'completed',
      output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
  });
  res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const child = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
  windowsHide: true,
  env: {
    ...process.env,
    FLUXCODE_TEST_DATA_DIR: data,
    WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webviewArguments,
    ...proxyEnv,
  },
  stdio: 'ignore',
});
let browser;
let page;
let restarted;
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert.ok(browser, 'WebView2 debugging endpoint must start');
  for (let attempt = 0; attempt < 20; attempt++) {
    page = browser.contexts()[0]?.pages()[0];
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(page, 'Native WebView page must exist');
  page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: '让想法，在代码中发生。' }).waitFor();
  await page.getByRole('button', { name: '最大化', exact: true }).click();
  await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
  await page.getByRole('button', { name: '还原窗口', exact: true }).click();
  await page.getByRole('button', { name: '最大化', exact: true }).waitFor();
  await page.evaluate(() =>
    localStorage.setItem(
      'fluxcode.appearance.v1',
      JSON.stringify({ language: 'zh-CN', theme: 'dark' }),
    ),
  );
  await page.reload();
  await page.getByRole('heading', { name: '让想法，在代码中发生。' }).waitFor();
  await page.screenshot({ path: resolve(root, 'work/native-welcome.png') });
  await page.evaluate(async (path) => {
    const snapshot = await window.__TAURI_INTERNALS__.invoke('load_ui_state');
    const values = { ...(snapshot?.values ?? {}) };
    values['fluxcode.catalog.v1'] = JSON.stringify({
      version: 1,
      projects: [{ id: 'native-project', name: 'FluxCode', path }],
      tasks: [],
    });
    await window.__TAURI_INTERNALS__.invoke('save_ui_state', {
      expectedGeneration: snapshot?.generation ?? null,
      values,
    });
  }, root);
  await page.reload();
  await page.getByRole('button', { name: 'README.md', exact: true }).waitFor();
  await page.screenshot({ path: resolve(root, 'docs/images/desktop.png') });
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page
    .getByLabel('服务地址', { exact: true })
    .fill(`http://127.0.0.1:${server.address().port}/v1`);
  await page.getByLabel('访问密钥', { exact: true }).fill('fixture-only-not-a-secret');
  await page.getByLabel('渠道名称', { exact: false }).fill('Native fixture');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.locator('.channel-card').filter({ hasText: 'Native fixture' }).waitFor();
  await page.screenshot({ path: resolve(root, 'work/native-channel.png') });
  await verifyNativeChannels(page, data, (models) => {
    fixtureModels = models;
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('spinbutton', { name: '上下文窗口上限' }).fill('200000');
  await page.getByRole('spinbutton', { name: '自动压缩阈值' }).fill('160000');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('textbox', { name: '任务描述' }).fill('请确认桌面应用的消息通路。');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByText('Native desktop integration passed.', { exact: true }).first().waitFor();
  assert.equal(payloads.at(-1).reasoning?.effort, undefined);
  if (!(await page.locator('.usage-indicator').getAttribute('open')))
    await page.locator('.usage-indicator summary').click();
  await page.getByRole('button', { name: '压缩上下文', exact: true }).click();
  await page.getByText('上下文已压缩', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '停止任务' }).waitFor({ state: 'hidden' });
  assert.match(await page.locator('.usage-indicator').innerText(), /190,000|190000/);
  await page.screenshot({ path: resolve(root, 'work/native-context.png') });
  await page.locator('.usage-indicator summary').click();
  await choose(page.getByRole('combobox', { name: '推理强度' }), 'high');
  await page.getByRole('textbox', { name: '任务描述' }).fill('确认当前会话的推理强度。');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('button', { name: '停止任务' }).waitFor({ state: 'hidden' });
  assert.equal(payloads.at(-1).reasoning?.effort, 'high');
  await page.getByRole('button', { name: '任务总览', exact: true }).click();
  const activity = page.getByRole('dialog', { name: '任务总览' });
  await activity.getByRole('textbox', { name: '搜索任务或项目' }).fill('请确认桌面应用');
  assert.equal(await activity.getByRole('listitem').count(), 1);
  assert.match(await activity.getByRole('listitem').innerText(), /已完成/);
  await activity.getByRole('listitem').getByRole('button').click();
  await activity.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '切换终端' }).click();
  await page.getByRole('button', { name: '命令', exact: true }).click();
  await page.getByRole('textbox', { name: '终端命令' }).fill("Write-Output 'native-terminal-ok'");
  await page.getByRole('button', { name: '执行命令' }).click();
  await page.waitForFunction(() =>
    document.querySelector('.terminal-output')?.textContent?.includes('[退出码 0]'),
  );
  assert.match(await page.locator('.terminal-output').innerText(), /native-terminal-ok/);
  await page.getByRole('button', { name: '交互式终端', exact: true }).click();
  await page.locator('.xterm-helper-textarea').waitFor({ state: 'attached' });
  await page.waitForFunction(() =>
    document.querySelector('.xterm-rows')?.textContent?.includes('PS '),
  );
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type("Write-Output 'pty-native-ok'");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.xterm-rows > div')).some(
      (row) => row.textContent?.trim() === 'pty-native-ok',
    ),
  );
  await page.getByRole('button', { name: '关闭终端', exact: true }).click();
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  assert.ok(
    (await page.locator('.xterm-rows').innerText()).includes('pty-native-ok'),
    'Hiding the terminal must preserve its process and output',
  );
  await page.getByRole('button', { name: '命令', exact: true }).click();
  await page.screenshot({ path: resolve(root, 'work/native-workspace.png') });
  const liveConfigPath = resolve(data, 'fluxcode.toml');
  const beforeDeferredEdit = await readFile(liveConfigPath, 'utf8');
  await writeFile(
    liveConfigPath,
    beforeDeferredEdit.replace('window_tokens = 200000', 'window_tokens = 210000'),
    'utf8',
  );
  await page
    .getByText('配置已更新，连接设置将在任务空闲时应用；已有终端保持原环境。', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '交互式终端', exact: true }).click();
  assert.ok((await page.locator('.xterm-rows').innerText()).includes('pty-native-ok'));
  await page.getByRole('button', { name: '结束终端会话 FluxCode', exact: true }).click();
  await page.locator('.configuration-notice').waitFor({ state: 'hidden' });
  await writeFile(liveConfigPath, beforeDeferredEdit, 'utf8');
  await page.waitForTimeout(600);
  await page.locator('.configuration-notice').waitFor({ state: 'hidden' });
  const config = await readFile(resolve(data, 'fluxcode.toml'), 'utf8');
  assert.match(config, /model = "native-fixture"/);
  assert.match(config, /window_tokens = 200000/);
  assert.match(config, /auto_compact_tokens = 160000/);
  assert.ok(!config.includes('fixture-only-not-a-secret'));
  assert.match(
    await readFile(resolve(data, 'engine-home/ENVIRONMENT.md'), 'utf8'),
    /Windows|windows/,
  );
  assert.match(await readFile(resolve(data, 'engine-home/AGENTS.md'), 'utf8'), /User instructions/);
  await page.reload();
  await page.getByText('执行引擎已就绪', { exact: true }).waitFor();
  await page.getByRole('button', { name: '请确认桌面应用的消息通路。', exact: true }).click();
  await page.getByText('Native desktop integration passed.', { exact: true }).first().waitFor();
  assert.equal(
    await page.getByRole('combobox', { name: '推理强度' }).getAttribute('data-value'),
    'high',
  );
  await choose(page.getByRole('combobox', { name: '推理强度' }), 'off');
  await page.getByRole('textbox', { name: '任务描述' }).fill('恢复服务默认推理设置。');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('button', { name: '停止任务' }).waitFor({ state: 'hidden' });
  assert.equal(payloads.at(-1).reasoning?.effort, undefined);
  const profiles = await readFile(resolve(data, 'providers.toml'), 'utf8');
  assert.match(profiles, /Native fixture/);
  assert.ok(!profiles.includes('fixture-only-not-a-secret'));
  assert.match(profiles, /models =/);
  await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    await invoke('forget_api_key', { settings: await invoke('load_settings') });
  });
  // External editor rename saves must update appearance without restarting the app.
  const configPath = resolve(data, 'fluxcode.toml');
  const beforeExternalEdit = await readFile(configPath, 'utf8');
  const externalEdit = beforeExternalEdit
    .replace(/font_size = \d+/, 'font_size = 18')
    .replace(/language = "[^"]+"/, 'language = "en"')
    .replace(/theme = "[^"]+"/, 'theme = "light"');
  await writeFile(`${configPath}.editor`, externalEdit, 'utf8');
  await rename(`${configPath}.editor`, configPath);
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'en' &&
      document.documentElement.dataset.theme === 'light' &&
      document.documentElement.style.getPropertyValue('--font-size') === '18px',
  );
  await writeFile(configPath, '[invalid', 'utf8');
  await page.getByText('The configuration file is invalid.', { exact: false }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await writeFile(configPath, beforeExternalEdit, 'utf8');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.locator('.configuration-notice').waitFor({ state: 'hidden' });
  const rejected = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const settings = await invoke('load_settings');
    try {
      await invoke('connect_engine', {
        settings: { ...settings, contextWindow: 220000 },
        apiKey: null,
        rememberKey: false,
        expectedRevision: 0,
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(rejected, 'Stale saves must be rejected without losing the active engine');
  await page
    .getByRole('textbox', { name: '任务描述' })
    .fill('检查配置保存失败后原连接仍然可用。[文档](https://example.com/docs?q=flux#start)');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('button', { name: '停止任务' }).waitFor({ state: 'hidden' });
  assert.ok(payloads.length >= 5);
  const link = page.getByRole('link', { name: '文档', exact: true });
  assert.equal(await link.getAttribute('href'), 'https://example.com/docs?q=flux#start');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.ok((await link.getAttribute('title')).includes('在应用内浏览器中打开'));
  const taskCount = await page.locator('.task-select').count();
  await page.locator('.task-menu').first().click();
  await page.getByRole('button', { name: '从此任务创建分支', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.task-select').count(), taskCount + 1);
  const second = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
    windowsHide: true,
    env: { ...process.env, FLUXCODE_TEST_DATA_DIR: data },
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('Second instance did not exit'));
    }, 5000);
    second.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('应用更新', { exact: true }).click();
  assert.ok(
    await page.getByRole('button', { name: '检查更新（暂未开放）', exact: true }).isDisabled(),
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native shutdown timed out')), 10000);
    if (child.exitCode !== null) {
      clearTimeout(timer);
      resolve();
    } else
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
  });
  const logs = await readdir(resolve(data, 'logs'));
  assert.ok(logs.length > 0);
  for (const name of logs) {
    const log = await readFile(resolve(data, 'logs', name), 'utf8');
    assert.ok(!log.includes('fixture-only-not-a-secret'));
    for (const line of log.trim().split('\n')) if (line) JSON.parse(line);
  }
  assert.match(
    await readFile(resolve(data, 'storage-layout.toml'), 'utf8'),
    /application-directory/,
  );
  const engineFiles = await readdir(resolve(data, 'engine-home'));
  assert.ok(engineFiles.some((name) => /^state_\d+\.sqlite$/.test(name)));
  const browserFiles = await readdir(
    resolve(data, 'webview', 'EBWebView', 'Default', 'Local Storage'),
  );
  assert.ok(
    browserFiles.includes('leveldb'),
    'Task index and drafts must be stored under the selected data directory',
  );
  await browser.close();
  browser = undefined;
  restarted = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
    windowsHide: true,
    env: {
      ...process.env,
      FLUXCODE_TEST_DATA_DIR: data,
      WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webviewArguments,
      ...proxyEnv,
    },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert.ok(browser, 'Desktop must restart without installation');
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(15000);
  await page.getByText('执行引擎已就绪', { exact: true }).waitFor();
  assert.equal(
    await page.locator('.task-select').count(),
    taskCount + 1,
    'Task index must survive a complete process restart',
  );
  await page
    .getByRole('button', { name: '请确认桌面应用的消息通路。', exact: true })
    .first()
    .click();
  await page.getByText('Native desktop integration passed.', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '工作区管理', exact: true }).click();
  const workspaces = page.getByRole('dialog', { name: '工作区管理' });
  await workspaces.getByRole('button', { name: '修改名称', exact: true }).click();
  await workspaces.getByRole('textbox', { name: '工作区名称', exact: true }).fill('原生工作区验收');
  await workspaces.getByRole('button', { name: '保存', exact: true }).click();
  await workspaces.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await workspaces.getByText('已关闭', { exact: true }).waitFor();
  await workspaces.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  assert.equal(await page.locator('.task-select').count(), 0);
  await page.getByRole('button', { name: '工作区管理', exact: true }).click();
  assert.match(await workspaces.innerText(), /原生工作区验收/);
  await workspaces.getByRole('button', { name: '重新打开', exact: true }).click();
  await page
    .getByRole('button', { name: '请确认桌面应用的消息通路。', exact: true })
    .first()
    .click();
  await page.getByText('Native desktop integration passed.', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.task-select').count(), taskCount + 1);
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  console.log(
    'PASS: single instance, fork, offline update placeholder, structured logs, native GUI, model discovery without a preselected model, TOML hot reload and recovery, deferred reconnect preserving PTY, stale-write rollback, credentials, resume, shutdown.',
  );
} catch (error) {
  if (page) {
    console.error(
      (
        await page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(-6000),
    );
    await page.screenshot({ path: resolve(root, 'work/native-failure.png') }).catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  if (restarted && restarted.exitCode === null) restarted.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function choose(control, value) {
  await control.click();
  await control.page().locator(`.select-item[data-value="${value}"]`).click();
}

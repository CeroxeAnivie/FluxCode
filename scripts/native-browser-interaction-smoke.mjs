import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-browser-interaction-${Date.now()}`);
await mkdir(data, { recursive: true });
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const payloads = [];
let sequence = 0;
let submissions = 0;
let takeover;
let pageUrl;
let mainPage;
let latest;
let firstSnapshot;
let materialResult;
const observations = [];
function observe(body) {
  const output = (body.input ?? [])
    .filter((item) => item.type === 'function_call_output')
    .at(-1)?.output;
  if (!output) return;
  observations.push(output);
  for (const part of Array.isArray(output) ? output : [{ text: output }]) {
    try {
      const parsed = JSON.parse(part.text);
      if (parsed.result?.snapshotId) {
        latest = parsed.result;
        firstSnapshot ??= latest;
      }
    } catch {}
  }
}
function target(label) {
  assert.ok(latest, 'A snapshot must precede element actions');
  const line = latest.untrustedPageContent
    .split('\n')
    .find((line) => line.includes('"' + label + '"') && /\[ref=/.test(line));
  const ref = line?.match(/\[ref=([a-zA-Z0-9]+)\]/)?.[1];
  assert.ok(ref, 'Missing snapshot target: ' + label);
  return { snapshotId: latest.snapshotId, ref };
}
const server = createServer((req, res) => {
  void (async () => {
    if (req.url === '/saved') {
      submissions++;
      res.writeHead(204).end();
      return;
    }
    if (req.url === '/frame') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<label>框架输入<input aria-label="框架输入"></label>');
      return;
    }
    if (req.url === '/preview') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Browser tool fixture</title>
      <style>body{font:16px system-ui;padding:24px}label{display:block;margin:12px}button,select,input{font:inherit}iframe{display:block;height:100px;margin:16px}#space{height:1200px}</style>
      <h1>内置浏览器工具验收</h1><p>browser-tool-native-ok</p>
      <form onsubmit="event.preventDefault();document.querySelector('#result').textContent='已保存 '+document.querySelector('#name').value;window.submits=(window.submits||0)+1;fetch('/saved',{method:'POST'})">
      <label>项目名称<input id="name" aria-label="项目名称"></label>
      <label><input type="checkbox" aria-label="启用功能">启用功能</label>
      <label>默认语言<select aria-label="默认语言"><option value="zh">中文</option><option value="en">English</option></select></label>
      <button type="submit">保存</button><button type="button" disabled>不可用</button></form>
      <p id="result"></p><button onclick="alert('网站确认')">显示对话框</button>
      <iframe title="测试框架" src="/frame"></iframe><div id="space"></div><p>页面底部</p>`);
      return;
    }
    if (req.url !== '/v1/responses') {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let bytes = Buffer.concat(chunks);
    if (req.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
    if (req.headers['content-encoding'] === 'zstd') bytes = zstdDecompressSync(bytes);
    const body = JSON.parse(bytes.toString('utf8'));
    payloads.push(body);
    observe(body);
    const step = sequence++;
    if (step === 0)
      assert.ok(
        body.input.some(
          (item) =>
            item.role === 'user' &&
            item.content?.some(
              (part) => part.type === 'input_image' && part.image_url?.startsWith('data:image/'),
            ),
        ),
        'Engine must receive a real image input',
      );
    if (step === 1) {
      let activePort;
      await expect
        .poll(
          async () => {
            activePort = await readFile(
              resolve(data, 'webview-browser/EBWebView/DevToolsActivePort'),
              'utf8',
            ).catch(() => '');
            return activePort;
          },
          { timeout: 5000 },
        )
        .not.toBe('');
      isolated = await chromium.connectOverCDP('http://127.0.0.1:' + activePort.split(/\r?\n/)[0]);
      // The observer must not auto-dismiss dialogs owned by the production driver.
      for (const page of isolated.contexts().flatMap((context) => context.pages()))
        page.on('dialog', () => {});
      await expect
        .poll(
          async () => {
            const remote = isolated
              .contexts()
              .flatMap((context) => context.pages())
              .find((page) => page.url() === pageUrl);
            return remote
              ? remote
                  .locator('body')
                  .innerText()
                  .catch(() => '')
              : '';
          },
          { timeout: 10000 },
        )
        .toContain('browser-tool-native-ok');
      await isolated.close();
      isolated = undefined;
    }
    if (step === 17)
      await mainPage.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke('browser_agent_control', { paused: true }),
      );
    if (step === 18) await mainPage.getByRole('button', { name: '允许智能体继续' }).click();
    if (step === 21) {
      takeover = (async () => {
        await expect(mainPage.getByText('正在点击网页元素', { exact: true })).toBeVisible();
        await mainPage.getByRole('button', { name: '停止并接管' }).click();
      })();
      // Observe immediately so a failed UI assertion cannot become unhandled.
      takeover.catch(() => {});
    }
    if (step === 22) {
      await takeover;
      await mainPage.getByRole('button', { name: '允许智能体继续' }).click();
    }

    const actions = [
      () => ({ action: 'open', url: pageUrl }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'fill', ...target('项目名称'), text: 'FluxCode browser verified' }),
      () => ({ action: 'set_checked', ...target('启用功能'), checked: true }),
      () => ({ action: 'select_option', ...target('默认语言'), values: ['en'] }),
      () => ({ action: 'hover', ...target('保存') }),
      () => ({ action: 'press', ...target('项目名称'), key: 'End' }),
      () => ({ action: 'click', ...target('保存') }),
      () => ({ action: 'screenshot' }),
      () => ({ action: 'scroll', deltaY: 450 }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'click', ...target('保存'), snapshotId: firstSnapshot.snapshotId }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'click', ...target('显示对话框') }),
      () => ({ action: 'handle_dialog', accept: true }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'fill', ...target('框架输入'), text: '跨框架输入成功' }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'click', ...target('不可用') }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'click', ...target('不可用') }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'close' }),
      () => ({ action: 'open', url: pageUrl }),
      () => ({ action: 'snapshot' }),
      () => ({ action: 'close' }),
    ];
    const item =
      step < actions.length
        ? {
            id: `tool-${step}`,
            type: 'function_call',
            call_id: `call-${step}`,
            namespace: 'mcp__fluxcode_browser',
            name: 'browser',
            arguments: JSON.stringify(actions[step]()),
            status: 'completed',
          }
        : {
            id: `message-${step}`,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              { type: 'output_text', text: 'Browser tool workflow complete.', annotations: [] },
            ],
          };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (type, rest) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`);
    emit('response.created', {
      response: { id: `response-${step}`, status: 'in_progress', output: [] },
    });
    emit('response.output_item.added', { output_index: 0, item });
    emit('response.output_item.done', { output_index: 0, item });
    emit('response.completed', {
      response: {
        id: `response-${step}`,
        status: 'completed',
        output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    });
    res.end();
  })().catch(async (error) => {
    console.error(error);
    await writeFile(
      resolve(data, 'fixture-payloads.json'),
      JSON.stringify(payloads, null, 2),
      'utf8',
    );
    res.writeHead(500).end('Fixture assertion failed');
  });
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
pageUrl = `${base}/preview`;
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
    FLUXCODE_TEST_WEBVIEW_ARGS: [
      `--remote-debugging-port=${port}`,
      ...(proxy
        ? [`--proxy-server=${new URL(proxy).origin}`, '--proxy-bypass-list=<-loopback>']
        : []),
    ].join(' '),
  },
});
let browser;
let isolated;
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
  assert.ok(browser, 'Native WebView2 must start');
  const main = browser.contexts()[0].pages()[0];
  mainPage = main;
  main.setDefaultTimeout(15000);
  await main.getByRole('button', { name: '打开浏览器', exact: true }).waitFor();
  const rpc = (method, params) =>
    main.evaluate(
      ({ method, params }) => window.__TAURI_INTERNALS__.invoke('engine_rpc', { method, params }),
      { method, params },
    );
  await main.evaluate(async (base) => {
    const settings = await window.__TAURI_INTERNALS__.invoke('load_settings');
    await window.__TAURI_INTERNALS__.invoke('connect_engine', {
      settings: { ...settings, baseUrl: `${base}/v1`, model: 'native-fixture', proxyUrl: '' },
      apiKey: 'fixture-only-not-a-secret',
      rememberKey: false,
    });
  }, base);
  const importedImage = await main.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext('2d');
    context.fillStyle = '#4080ff';
    context.fillRect(0, 0, 32, 24);
    const source = canvas.toDataURL('image/png');
    const path = await invoke('store_chat_image', { source });
    const duplicate = await invoke('store_chat_image', { source });
    const preview = await invoke('load_chat_image', { source: path, full: true });
    return { path, duplicate, preview };
  });
  assert.equal(
    importedImage.path,
    importedImage.duplicate,
    'Identical image imports are deduplicated',
  );
  assert.ok(importedImage.path.startsWith(resolve(data, 'attachments')));
  assert.match(importedImage.preview, /^data:image\/png;base64,/);
  await expect(
    main.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke('store_chat_image', {
        source: 'data:image/png;base64,bm90LWFuLWltYWdl',
      }),
    ),
  ).rejects.toBeDefined();
  materialResult = await main.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const disabled = await invoke('configure_window_material', { dark: true, enabled: false });
    const enabled = await invoke('configure_window_material', { dark: true, enabled: true });
    return { disabled, enabled };
  });
  assert.equal(materialResult.disabled.applied, false);
  assert.ok(
    ['native-acrylic', 'system-preference', 'unsupported'].includes(materialResult.enabled.reason),
  );
  const thread = await rpc('thread/start', { cwd: root, model: 'native-fixture' });
  let status;
  await expect
    .poll(
      async () => {
        status = await rpc('mcpServerStatus/list', { threadId: thread.thread.id, limit: 100 });
        return status.data.find((row) => row.name === 'fluxcode_browser')?.runtimeStatus;
      },
      { timeout: 20000 },
    )
    .toBe('connected');
  const capability = status.data.find((row) => row.name === 'fluxcode_browser');
  assert.ok(Object.keys(capability.tools).some((name) => name.includes('browser')));
  await rpc('turn/start', {
    threadId: thread.thread.id,
    model: 'native-fixture',
    collaborationMode: {
      mode: 'default',
      settings: { model: 'native-fixture', reasoning_effort: null, developer_instructions: '' },
    },
    input: [
      {
        type: 'text',
        text: 'Use the built-in browser tool and inspect this image.',
        text_elements: [],
      },
      { type: 'localImage', path: importedImage.path },
    ],
  });
  await expect.poll(() => payloads.length, { timeout: 90000 }).toBe(28);
  const outputs = payloads
    .flatMap((payload) => payload.input ?? [])
    .filter((item) => item.type === 'function_call_output');
  const result = (id) => JSON.stringify(outputs.find((row) => row.call_id === id)?.output ?? '');
  assert.match(result('call-0'), /FluxCode built-in browser/);
  assert.match(result('call-2'), /FluxCode browser verified/);
  assert.match(result('call-3'), /checked/);
  assert.match(result('call-4'), /English/);
  assert.match(result('call-7'), /已保存 FluxCode browser verified/);
  assert.match(result('call-8'), /image/);
  assert.match(result('call-11'), /page or target changed/);
  assert.match(result('call-14'), /performed/);
  assert.match(result('call-16'), /跨框架输入成功/);
  assert.match(result('call-17'), /用户接管/);
  assert.match(result('call-18'), /snapshotId/);
  assert.match(result('call-19'), /did not complete/);
  assert.match(result('call-21'), /用户已停止/);
  assert.match(result('call-22'), /snapshotId/);
  assert.match(result('call-23'), /FluxCode built-in browser/);
  assert.match(result('call-25'), /browser-tool-native-ok/);
  assert.match(result('call-26'), /FluxCode built-in browser/);
  assert.equal(submissions, 1, 'Form submission must never be repeated');
  await expect(main.getByRole('complementary', { name: '应用内浏览器' })).toHaveCount(0);
  assert.ok(
    !browser
      .contexts()
      .flatMap((context) => context.pages())
      .some((page) => page.url() === pageUrl),
    'Remote page must be isolated from app CDP',
  );
  const environment = await readFile(resolve(data, 'engine-home/ENVIRONMENT.md'), 'utf8');
  assert.match(environment, /fluxcode_browser/);
  await writeFile(
    resolve(data, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        discovered: Object.keys(capability.tools),
        calls: 27,
        nativeReadback: true,
        imageInput: true,
        material: materialResult,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'passed', data, calls: 27, nativeReadback: true }));
} catch (error) {
  await writeFile(
    resolve(data, 'fixture-payloads.json'),
    JSON.stringify(payloads, null, 2),
    'utf8',
  );
  console.error(`Native browser tool diagnostics: ${data}`);
  throw error;
} finally {
  await isolated?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  await new Promise((done) => server.close(done));
}

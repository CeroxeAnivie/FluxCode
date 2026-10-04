import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-browser-tool-${Date.now()}`);
await mkdir(data, { recursive: true });
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const payloads = [];
let sequence = 0;
let pageUrl;
const server = createServer(async (req, res) => {
  if (req.url === '/preview') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><title>Browser tool fixture</title><h1>内置浏览器工具验收</h1><p>真实页面正文 browser-tool-native-ok</p><a href="/next">下一页</a>',
    );
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
  const step = sequence++;
  if (step === 1) {
    await expect
      .poll(
        async () => {
          const remote = browser
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
  }
  const actions = [
    { action: 'open', url: pageUrl },
    { action: 'read_page' },
    { action: 'open', url: 'file:///C:/secret' },
    { action: 'close' },
  ];
  const item =
    step < actions.length
      ? {
          id: `tool-${step}`,
          type: 'function_call',
          call_id: `call-${step}`,
          namespace: 'mcp__fluxcode_browser',
          name: 'browser',
          arguments: JSON.stringify(actions[step]),
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
  assert.ok(browser, 'Native WebView2 must start');
  const main = browser.contexts()[0].pages()[0];
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
    input: [{ type: 'text', text: 'Use the built-in browser tool.', text_elements: [] }],
  });
  await expect.poll(() => payloads.length, { timeout: 30000 }).toBe(5);
  const outputs = payloads
    .flatMap((payload) => payload.input ?? [])
    .filter((item) => item.type === 'function_call_output');
  const result = (id) => JSON.stringify(outputs.find((row) => row.call_id === id)?.output ?? '');
  assert.match(result('call-0'), /FluxCode built-in browser/);
  assert.match(result('call-1'), /browser-tool-native-ok/);
  assert.match(result('call-1'), /Browser tool fixture/);
  assert.match(result('call-2'), /仅支持不含登录凭据的 HTTP\(S\) 网页链接/);
  assert.match(result('call-3'), /FluxCode built-in browser/);
  await expect(main.getByRole('complementary', { name: '应用内浏览器' })).toHaveCount(0);
  const environment = await readFile(resolve(data, 'engine-home/ENVIRONMENT.md'), 'utf8');
  assert.match(environment, /fluxcode_browser/);
  await writeFile(
    resolve(data, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        discovered: Object.keys(capability.tools),
        calls: 4,
        nativeReadback: true,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'passed', data, calls: 4, nativeReadback: true }));
} catch (error) {
  await writeFile(
    resolve(data, 'fixture-payloads.json'),
    JSON.stringify(payloads, null, 2),
    'utf8',
  );
  console.error(`Native browser tool diagnostics: ${data}`);
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  await new Promise((done) => server.close(done));
}

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, copyFile, cp, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { resolve, toNamespacedPath } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from '@playwright/test';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

const project = resolve(import.meta.dirname, '..');
const releaseDirectory = resolve(project, 'src-tauri/target/release');
const executable = resolve(releaseDirectory, 'fluxcode.exe');
const fixtureRoot = resolve(project, 'work', `native-data-move-${Date.now()}`);
const first = resolve(fixtureRoot, 'APP');
const caseChanged = resolve(fixtureRoot, 'app');
const longSegments = Number(process.env.FLUX_MOVE_SEGMENTS || '3');
const segmentSize = Number(process.env.FLUX_MOVE_SEGMENT_SIZE || '60');
const longParent = Array.from(
  { length: longSegments },
  (_, index) => `segment-${index}-${'a'.repeat(segmentSize)}`,
).reduce((parent, segment) => resolve(parent, segment), fixtureRoot);
const unicode = resolve(longParent, 'FluxCode-中文');
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const proxyEnv = proxy
  ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: '', no_proxy: '' }
  : {};
const prompts = ['移动前的历史任务', '仅修改大小写后继续', '中文长路径后继续'];
const replies = ['第一段已保存。', '第二段已保存。', '第三段已保存。'];
let responseCount = 0;
let current;

function sendResponse(res, reply) {
  const id = ++responseCount;
  const item = {
    id: `move-message-${id}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: reply, annotations: [] }],
  };
  const event = (type, fields) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  event('response.created', {
    response: { id: `move-response-${id}`, status: 'in_progress', output: [] },
  });
  event('response.output_item.added', {
    output_index: 0,
    item: { ...item, status: 'in_progress', content: [] },
  });
  event('response.output_text.delta', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: reply,
  });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', {
    response: {
      id: `move-response-${id}`,
      status: 'completed',
      output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
  });
  res.end();
}

const fixture = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ id: 'native-move-fixture' }] }));
    return;
  }
  if (req.url !== '/v1/responses') {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
    if (req.headers['content-encoding'] === 'zstd') body = zstdDecompressSync(body);
    const request = JSON.parse(body.toString('utf8'));
    assert.equal(request.model, 'native-move-fixture');
    assert.equal(request.stream, true);
    const input = JSON.stringify(request.input);
    const index = prompts.findLastIndex((prompt) => input.includes(prompt));
    assert.ok(index >= 0, 'The engine must send one of the move-test turns');
    sendResponse(res, replies[index]);
  } catch (error) {
    console.error('Responses fixture failed:', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

async function freeLocalPort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  return port;
}

async function moveDirectory(source, target) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      lastError = error;
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  throw lastError;
}

async function launch(directory) {
  const debugPort = await freeLocalPort();
  const argumentsForWebView = [
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    ...(proxy ? [`--proxy-server=${new URL(proxy).origin}`] : []),
  ].join(' ');
  const executablePath = resolve(directory, 'FluxCode.exe');
  const child = spawn(
    directory.length > 240 ? toNamespacedPath(executablePath) : executablePath,
    [],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        RUST_BACKTRACE: '1',
        // Let the application resolve its own portable WebView directory.
        WEBVIEW2_USER_DATA_FOLDER: undefined,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: argumentsForWebView,
        ...proxyEnv,
      },
    },
  );
  let diagnostics = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk.toString('utf8')).slice(-10000);
    });
  }
  let launchError;
  child.once('error', (error) => {
    launchError = error;
  });
  current = { child };
  let lastError;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null || launchError) break;
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
      const page = browser.contexts()[0]?.pages()[0];
      if (page) {
        page.setDefaultTimeout(20000);
        page.on('pageerror', (error) => console.error('WebView page error:', error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') console.error('WebView console:', message.text());
        });
        page.on('requestfailed', (request) =>
          console.error('WebView request failed:', request.url(), request.failure()?.errorText),
        );
        await page.waitForURL('http://tauri.localhost/', { timeout: 20000 });
        current = { child, browser, page };
        return current;
      }
      await browser.close();
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(
    `Moved desktop did not open (exit code ${child.exitCode}): ${launchError || lastError}\n${diagnostics}`,
  );
}

async function stopDesktop() {
  const { child, browser, page } = current;
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  if (child.exitCode === null) {
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Desktop shutdown timed out')), 30000);
      child.once('exit', () => {
        clearTimeout(timeout);
        done();
      });
    });
  }
  await browser.close().catch(() => {});
  current = undefined;
}

async function assertLayout(directory) {
  const data = resolve(directory, 'data');
  const layout = await readFile(resolve(data, 'storage-layout.toml'), 'utf8');
  assert.match(layout, /^version = 1$/m);
  assert.ok(
    layout.includes(data) || layout.includes(JSON.stringify(data).slice(1, -1)),
    'Storage layout must refer to the moved data directory',
  );
  await access(resolve(data, 'engine-home'));
  await access(resolve(data, 'webview'));
  const mirror = JSON.parse(await readFile(resolve(data, 'ui-state-mirror.json'), 'utf8'));
  assert.equal(mirror.version, 1);
  assert.ok(mirror.generation > 0);
  assert.ok(
    mirror.values['fluxcode.catalog.v1']?.includes(prompts[0]),
    'Application-owned UI state must retain the conversation catalog',
  );
  const sessionDirectory = resolve(data, 'engine-home', 'sessions');
  const sessions = (await readdir(sessionDirectory, { recursive: true })).filter((name) =>
    name.endsWith('.jsonl'),
  );
  assert.ok(sessions.length > 0, 'The engine must retain its own session history');
  const stateFiles = (await readdir(resolve(data, 'engine-home'))).filter((name) =>
    /^state_.*\.sqlite$/.test(name),
  );
  assert.ok(stateFiles.length > 0, 'The engine must have a durable session index');
  let indexed = 0;
  // Node's SQLite build has its own MAX_PATH restriction. Resolve an alias of
  // the existing directory for the verifier, just as the application does.
  const sqliteDirectory = windowsShortPath(resolve(data, 'engine-home'));
  for (const file of stateFiles) {
    const database = new DatabaseSync(resolve(sqliteDirectory, file), { readOnly: true });
    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
        .all();
      if (!tables.length) continue;
      for (const row of database.prepare('SELECT rollout_path FROM threads').all()) {
        if (!row.rollout_path) continue;
        indexed++;
        assert.ok(
          [resolve(data, 'engine-home'), toNamespacedPath(resolve(data, 'engine-home'))].some(
            (prefix) => row.rollout_path.toLowerCase().startsWith(prefix.toLowerCase() + '\\'),
          ),
          `Session index still refers outside the moved data directory: ${row.rollout_path}`,
        );
        await access(row.rollout_path);
      }
    } finally {
      database.close();
    }
  }
  assert.ok(indexed > 0, 'At least one history entry must be indexed');
}

function windowsShortPath(path) {
  const script = `
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class FluxMovePath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern uint GetShortPathName(string path, StringBuilder output, uint size); }'
    $buffer = [System.Text.StringBuilder]::new(32768)
    $length = [FluxMovePath]::GetShortPathName($env:FLUX_TEST_SQLITE_PATH, $buffer, 32768)
    if ($length -eq 0 -or $length -ge 32768) { throw 'Cannot resolve fixture SQLite directory alias' }
    [Console]::Write($buffer.ToString())
  `;
  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      env: { ...process.env, FLUX_TEST_SQLITE_PATH: path },
    },
  ).trim();
}

async function continueTask(page, prompt, reply) {
  await page.getByRole('textbox', { name: '任务描述' }).fill(prompt);
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByText(reply, { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '停止任务' }).waitFor({ state: 'hidden' });
}

async function verifyHistory(page, count) {
  const state = await page.evaluate(() => ({
    origin: location.origin,
    storedKeys: localStorage.length,
    hasCatalog: localStorage.getItem('fluxcode.catalog.v1') !== null,
  }));
  console.log(`Resumed WebView state: ${JSON.stringify(state)}`);
  await page.getByText('执行引擎已就绪', { exact: true }).waitFor();
  await page.getByRole('button', { name: prompts[0], exact: true }).waitFor();
  await page.getByRole('button', { name: prompts[0], exact: true }).click();
  // Verify UI hydration before probing RPC: an explicit resume can otherwise
  // repair a broken frontend restore path and make this acceptance test pass.
  for (const reply of replies.slice(0, count)) {
    await page.getByText(reply, { exact: true }).first().waitFor();
  }
  const taskId = await page.evaluate(() => {
    const raw = localStorage.getItem('fluxcode.catalog.v1');
    return raw ? JSON.parse(raw).tasks?.[0]?.id : null;
  });
  if (typeof taskId === 'string') {
    const resumed = await page.evaluate(
      async ({ threadId }) => {
        try {
          return await window.__TAURI_INTERNALS__.invoke('engine_rpc', {
            method: 'thread/resume',
            params: {
              threadId,
              sandbox: 'danger-full-access',
              approvalPolicy: 'never',
              excludeTurns: false,
            },
          });
        } catch (error) {
          return { error: String(error) };
        }
      },
      { threadId: taskId },
    );
    assert.ok(!resumed.error, `Engine history resume failed: ${resumed.error}`);
    assert.equal(resumed.thread?.id, taskId);
    console.log('PASS: engine resumed the original thread after UI history restoration');
  }
}

await access(executable);
await mkdir(resolve(first, 'data'), { recursive: true });
await copyFile(executable, resolve(first, 'FluxCode.exe'));
for (const resource of ['engine', 'legal']) {
  await cp(resolve(releaseDirectory, resource), resolve(first, resource), { recursive: true });
}
await new Promise((done) => fixture.listen(0, '127.0.0.1', done));

try {
  let desktop = await launch(first);
  await desktop.page.getByRole('heading', { name: '让想法，在代码中发生。' }).waitFor();
  await desktop.page.evaluate(async (path) => {
    const snapshot = await window.__TAURI_INTERNALS__.invoke('load_ui_state');
    const catalog = JSON.stringify({
      version: 1,
      projects: [{ id: 'move-project', name: 'FluxCode', path }],
      tasks: [],
    });
    await window.__TAURI_INTERNALS__.invoke('save_ui_state', {
      values: { ...snapshot.values, 'fluxcode.catalog.v1': catalog },
      expectedGeneration: snapshot.generation,
    });
    localStorage.setItem('fluxcode.catalog.v1', catalog);
  }, project);
  await desktop.page.reload();
  await desktop.page.getByRole('button', { name: 'README.md', exact: true }).waitFor();
  await desktop.page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await desktop.page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await desktop.page
    .getByLabel('服务地址', { exact: true })
    .fill(`http://127.0.0.1:${fixture.address().port}/v1`);
  await desktop.page.getByLabel('访问密钥', { exact: true }).fill('native-move-fixture-key');
  await desktop.page.getByLabel('渠道名称', { exact: false }).fill('Native move fixture');
  await desktop.page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await desktop.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await continueTask(desktop.page, prompts[0], replies[0]);
  await stopDesktop();
  await assertLayout(first);

  await moveDirectory(first, caseChanged);
  desktop = await launch(caseChanged);
  await verifyHistory(desktop.page, 1);
  await continueTask(desktop.page, prompts[1], replies[1]);
  await stopDesktop();
  await assertLayout(caseChanged);

  await mkdir(longParent, { recursive: true });
  console.log(`Move destination length: ${unicode.length}`);
  await moveDirectory(caseChanged, unicode);
  desktop = await launch(unicode);
  await verifyHistory(desktop.page, 2);
  await continueTask(desktop.page, prompts[2], replies[2]);
  await desktop.page.evaluate(async () =>
    window.__TAURI_INTERNALS__.invoke('forget_api_key', {
      settings: await window.__TAURI_INTERNALS__.invoke('load_settings'),
    }),
  );
  await stopDesktop();
  await assertLayout(unicode);
  console.log(
    `PASS: real desktop directory move, case change, Unicode long path and continued history (${fixtureRoot})`,
  );
} catch (error) {
  if (current?.page) {
    await current.page
      .evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__moveDiagnostic = text;
            },
          },
        });
      })
      .catch(() => {});
    await current.page
      .getByRole('button', { name: '复制诊断信息', exact: true })
      .first()
      .click({ timeout: 1000 })
      .catch(() => {});
    console.error(
      'Redacted startup diagnostic:',
      await current.page.evaluate(() => window.__moveDiagnostic ?? '').catch(() => ''),
    );
    console.error('WebView URL:', current.page.url());
    console.error('WebView HTML:', (await current.page.content().catch(() => '')).slice(0, 1200));
    console.error(
      (
        await current.page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(-4000),
    );
    await current.page
      .screenshot({ path: resolve(fixtureRoot, 'native-data-move-failure.png') })
      .catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  if (current?.child?.exitCode === null) current.child.kill();
  await current?.browser?.close().catch(() => {});
  fixture.closeAllConnections();
  await new Promise((done) => fixture.close(done));
}

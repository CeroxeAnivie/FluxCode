import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const home = resolve(root, 'work', `smoke-${Date.now()}`);
await mkdir(home, { recursive: true });
const fixture = createServer();
let inferenceRequests = 0;
let expectedEffort;
const payloads = [];
fixture.on('request', async (req, res) => {
  if (req.url !== '/v1/responses') {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let bytes = Buffer.concat(chunks);
    if (req.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
    if (req.headers['content-encoding'] === 'zstd') bytes = zstdDecompressSync(bytes);
    const body = JSON.parse(bytes.toString('utf8'));
    assert.equal(body.reasoning?.effort, expectedEffort);
    payloads.push(body);
    assert.equal(body.stream, true);
    await writeFile(
      resolve(root, 'work/smoke-tools.json'),
      JSON.stringify(body.tools, null, 2),
      'utf8',
    );
    inferenceRequests++;
    const item = {
      type: 'message',
      id: 'msg_fixture',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'FluxCode smoke passed.', annotations: [] }],
    };
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const event = (type, rest) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`);
    event('response.created', {
      response: {
        id: 'resp_fixture',
        object: 'response',
        model: body.model,
        status: 'in_progress',
        output: [],
      },
    });
    event('response.output_item.added', {
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    });
    event('response.content_part.added', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    });
    event('response.output_text.delta', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: 'FluxCode smoke passed.',
    });
    event('response.output_text.done', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: 'FluxCode smoke passed.',
    });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', {
      response: {
        id: 'resp_fixture',
        object: 'response',
        model: body.model,
        status: 'completed',
        output: [item],
        usage: {
          input_tokens: 20,
          output_tokens: 6,
          total_tokens: 26,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    });
    res.end();
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const args = ['app-server', '--listen', 'stdio://'];
for (const config of [
  `model_catalog_json=${JSON.stringify(resolve(root, 'config/engine-models.json'))}`,
  'model="flux-fixture"',
  'model_provider="fluxcode"',
  'model_providers.fluxcode.name="FluxCode fixture"',
  `model_providers.fluxcode.base_url="http://127.0.0.1:${fixture.address().port}/v1"`,
  'model_providers.fluxcode.wire_api="responses"',
  'model_providers.fluxcode.env_key="FLUX_FIXTURE_KEY"',
  'approval_policy="never"',
  'sandbox_mode="danger-full-access"',
  'analytics.enabled=false',
  'check_for_update_on_startup=false',
])
  args.push('-c', config);
const child = spawn(resolve(root, 'src-tauri/resources/engine/codex.exe'), args, {
  windowsHide: true,
  env: {
    ...process.env,
    CODEX_HOME: home,
    ...(proxy
      ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: '', no_proxy: '' }
      : {}),
    FLUX_FIXTURE_KEY: 'fixture-not-a-real-secret',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let nextId = 0;
const pending = new Map();
const events = [];
let diagnostics = '';
child.stderr.on('data', (chunk) => {
  diagnostics = (diagnostics + chunk.toString('utf8')).slice(-24000);
});
createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method) events.push(message);
  if (pending.has(message.id)) {
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 45000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  await rpc('initialize', {
    clientInfo: { name: 'fluxcode_smoke', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const started = await rpc('thread/start', {
    cwd: home,
    model: 'flux-fixture',
    modelProvider: 'fluxcode',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  });
  assert.equal(started.approvalPolicy, 'never');
  assert.equal(started.sandbox.type, 'dangerFullAccess');
  for (const model of ['flux-fixture', 'gpt-5.4']) {
    for (const effort of [null, 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', null]) {
      expectedEffort = effort ?? undefined;
      const before = events.length;
      await rpc('turn/start', {
        threadId: started.thread.id,
        model,
        collaborationMode: {
          mode: 'default',
          settings: { model, reasoning_effort: effort, developer_instructions: '' },
        },
        input: [{ type: 'text', text: 'Reply briefly.', text_elements: [] }],
      });
      const deadline = Date.now() + 45000;
      while (
        !events.slice(before).some((e) => e.method === 'turn/completed') &&
        Date.now() < deadline
      )
        await new Promise((r) => setTimeout(r, 100));
      const done = events.slice(before).find((e) => e.method === 'turn/completed');
      assert.equal(done?.params.turn.status, 'completed', JSON.stringify(done));
      assert.equal(payloads.at(-1).model, model);
      console.log('PASS wire', model, effort ?? 'off');
    }
  }
  await rpc('thread/archive', { threadId: started.thread.id });
  console.log(
    'PASS: real engine Responses effort omission, all native levels, high-to-Off, known and custom models. No production API used.',
  );
} catch (error) {
  await writeFile(resolve(root, 'work/smoke-diagnostics.log'), diagnostics, 'utf8');
  console.error(error);
  console.error('Fixture-only engine diagnostics: work/smoke-diagnostics.log');
  process.exitCode = 1;
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  child.stdin.end();
  child.kill();
  await new Promise((resolve) => {
    fixture.close(resolve);
    fixture.closeAllConnections();
  });
}

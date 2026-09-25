import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `network-fault-${Date.now()}`);
await mkdir(data, { recursive: true });
let mode = 'unauthorized',
  requests = 0;
const server = createServer((request, response) => {
  request.resume();
  requests++;
  if (mode === 'unauthorized' || mode === 'limited' || mode === 'server-error') {
    response
      .writeHead(mode === 'unauthorized' ? 401 : mode === 'limited' ? 429 : 503, {
        'content-type': 'application/json',
      })
      .end(JSON.stringify({ error: { message: 'Declared local fault fixture' } }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (mode === 'invalid-sse') response.end('event: response.completed\ndata: {invalid\n\n');
  else {
    response.write(
      'event: response.created\ndata: {"type":"response.created","response":{"id":"fixture","status":"in_progress","output":[]}}\n\n',
    );
    if (mode === 'truncated') response.end();
    // The idle case deliberately never sends completion. The declared idle deadline must fail it.
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const args = ['app-server', '--listen', 'stdio://'];
for (const setting of [
  'model="flux-fixture"',
  'model_provider="fluxcode"',
  `model_catalog_json=${JSON.stringify(resolve(root, 'config/engine-models.json'))}`,
  'model_providers.fluxcode.name="Local failure fixture"',
  `model_providers.fluxcode.base_url="http://127.0.0.1:${server.address().port}/v1"`,
  'model_providers.fluxcode.wire_api="responses"',
  'model_providers.fluxcode.env_key="FLUX_FIXTURE_KEY"',
  'model_providers.fluxcode.request_max_retries=0',
  'model_providers.fluxcode.stream_max_retries=0',
  'model_providers.fluxcode.stream_idle_timeout_ms=1000',
  'approval_policy="never"',
  'sandbox_mode="danger-full-access"',
  'analytics.enabled=false',
  'check_for_update_on_startup=false',
])
  args.push('-c', setting);
const child = spawn(resolve(root, 'src-tauri/resources/engine/codex.exe'), args, {
  env: {
    ...process.env,
    CODEX_HOME: data,
    FLUX_FIXTURE_KEY: 'fixture-only',
    NO_PROXY: '',
    no_proxy: '',
  },
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'ignore'],
});
let sequence = 0;
const pending = new Map(),
  completions = new Map(),
  waiters = new Map();
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  const value = JSON.parse(line);
  if (pending.has(value.id)) {
    const entry = pending.get(value.id);
    pending.delete(value.id);
    clearTimeout(entry.timer);
    if (value.error) entry.reject(new Error(value.error.message));
    else entry.resolve(value.result);
  }
  if (value.method === 'turn/completed') {
    const id = value.params.threadId;
    completions.set(id, value.params.turn);
    waiters.get(id)?.(value.params.turn);
  }
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} deadline`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function completed(id) {
  if (completions.has(id)) return completions.get(id);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Failure did not settle the turn')), 15000);
      waiters.set(id, resolve);
    });
  } finally {
    clearTimeout(timer);
    waiters.delete(id);
  }
}
const results = [];
try {
  await rpc('initialize', { clientInfo: { name: 'fluxcode_fault_fixture', version: '0.1.0' } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  for (mode of ['unauthorized', 'limited', 'server-error', 'invalid-sse', 'truncated', 'idle']) {
    const before = requests;
    const { thread } = await rpc('thread/start', {
      cwd: data,
      model: 'flux-fixture',
      modelProvider: 'fluxcode',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    await rpc('turn/start', {
      threadId: thread.id,
      input: [{ type: 'text', text: 'Declared failure test.', text_elements: [] }],
    });
    const turn = await completed(thread.id);
    assert.equal(turn.status, 'failed', mode);
    assert.equal(requests - before, 1, `${mode} must not replay accepted input`);
    results.push({ mode, status: turn.status, requests: requests - before });
  }
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ results }, null, 2), 'utf8');
  console.log(JSON.stringify({ result: 'passed', data, results }));
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  lines.close();
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}

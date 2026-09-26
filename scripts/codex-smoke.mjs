import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const codeMode = process.argv.includes('--code-mode');
const model = codeMode ? 'gpt-5.6-sol' : 'flux-fixture';
const home = resolve(root, 'work', `smoke-${Date.now()}`);
await mkdir(home, { recursive: true });
const fixture = createServer();
let inferenceRequests = 0;
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
    assert.equal(body.model, model);
    assert.equal(body.stream, true);
    const tools =
      body.tools ??
      body.input.filter((item) => item.type === 'additional_tools').flatMap((item) => item.tools);
    if (inferenceRequests === 0)
      await writeFile(
        resolve(root, 'work/smoke-tools.json'),
        JSON.stringify(tools, null, 2),
        'utf8',
      );
    inferenceRequests++;
    if (inferenceRequests === 1) {
      const command = {
        cmd: "[System.IO.File]::WriteAllText('agent-created.txt', 'tool-loop-ok', [System.Text.UTF8Encoding]::new($false)); Get-Content -LiteralPath 'agent-created.txt' -Encoding UTF8",
        shell: 'powershell.exe',
        login: false,
        workdir: home,
        max_output_tokens: 1000,
      };
      assert.match(JSON.stringify(tools), codeMode ? /"name":"exec"/ : /"name":"exec_command"/);
      const item = codeMode
        ? {
            type: 'custom_tool_call',
            id: 'ctc_fixture',
            call_id: 'call_fixture',
            name: 'exec',
            input: `const result = await tools.exec_command(${JSON.stringify(command)}); text(result);`,
          }
        : {
            type: 'function_call',
            id: 'fc_fixture',
            call_id: 'call_fixture',
            name: 'exec_command',
            arguments: JSON.stringify(command),
          };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (type, rest) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`);
      emit('response.created', {
        response: { id: 'resp_tool', status: 'in_progress', output: [] },
      });
      emit('response.output_item.added', { output_index: 0, item: { ...item, arguments: '' } });
      if (!codeMode) {
        emit('response.function_call_arguments.delta', {
          output_index: 0,
          item_id: item.id,
          delta: item.arguments,
        });
        emit('response.function_call_arguments.done', {
          output_index: 0,
          item_id: item.id,
          arguments: item.arguments,
        });
      }
      emit('response.output_item.done', { output_index: 0, item });
      emit('response.completed', {
        response: {
          id: 'resp_tool',
          status: 'completed',
          output: [item],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
        },
      });
      res.end();
      return;
    }
    const toolOutput = body.input.find(
      (item) => item.type === (codeMode ? 'custom_tool_call_output' : 'function_call_output'),
    );
    assert.ok(toolOutput, 'Engine must return actual tool output');
    assert.match(JSON.stringify(toolOutput.output), /tool-loop-ok/);
    assert.doesNotMatch(JSON.stringify(toolOutput.output), /failed to spawn/);
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
    console.error('Fixture assertion failed:', error);
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const args = ['app-server', '--listen', 'stdio://'];
for (const config of [
  `model=${JSON.stringify(model)}`,
  'model_provider="fluxcode"',
  `model_catalog_json=${JSON.stringify(resolve(root, 'config/engine-models.json'))}`,
  'model_providers.fluxcode.name="FluxCode fixture"',
  `model_providers.fluxcode.base_url="http://127.0.0.1:${fixture.address().port}/v1"`,
  'model_providers.fluxcode.wire_api="responses"',
  'model_providers.fluxcode.env_key="FLUX_FIXTURE_KEY"',
  'model_providers.fluxcode.request_max_retries=0',
  'model_providers.fluxcode.stream_max_retries=0',
  'approval_policy="never"',
  'sandbox_mode="danger-full-access"',
  'analytics.enabled=false',
  'check_for_update_on_startup=false',
])
  args.push('-c', config);
const child = spawn(
  process.env.FLUXCODE_ENGINE_BIN || resolve(root, 'src-tauri/resources/engine/codex.exe'),
  args,
  {
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
  },
);
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
    capabilities: { experimentalApi: false },
  });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const started = await rpc('thread/start', {
    cwd: home,
    model,
    modelProvider: 'fluxcode',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  });
  assert.equal(started.approvalPolicy, 'never');
  assert.equal(started.sandbox.type, 'dangerFullAccess');
  await rpc('turn/start', {
    threadId: started.thread.id,
    input: [{ type: 'text', text: 'Reply briefly.', text_elements: [] }],
  });
  const deadline = Date.now() + 45000;
  while (!events.some((e) => e.method === 'turn/completed') && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const completed = events.find((e) => e.method === 'turn/completed');
  assert.ok(completed, 'turn/completed must arrive');
  assert.equal(completed.params.turn.status, 'completed', JSON.stringify(completed));
  assert.ok(
    events.some(
      (e) => e.method === 'item/agentMessage/delta' && e.params.delta.includes('smoke passed'),
    ),
  );
  assert.equal(inferenceRequests, 2);
  assert.equal(await readFile(resolve(home, 'agent-created.txt'), 'utf8'), 'tool-loop-ok');
  assert.ok(
    events.some((e) => e.method === 'item/completed' && e.params.item.type === 'commandExecution'),
  );
  const resumed = await rpc('thread/resume', { threadId: started.thread.id, excludeTurns: false });
  assert.equal(resumed.thread.id, started.thread.id);
  if (resumed.thread.historyMode === 'paginated') {
    const items = await rpc('thread/items/list', {
      threadId: started.thread.id,
      limit: 100,
      sortDirection: 'asc',
    });
    assert.ok(items.data.some((row) => row.item.type === 'agentMessage'));
  } else assert.ok(resumed.thread.turns.length);
  const exec = await rpc('command/exec', {
    command: [
      'powershell.exe',
      '-NoProfile',
      '-Command',
      "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Write-Output 'terminal-smoke'",
    ],
    cwd: home,
    timeoutMs: 10000,
    sandboxPolicy: { type: 'dangerFullAccess' },
  });
  assert.equal(exec.exitCode, 0);
  assert.match(exec.stdout, /terminal-smoke/);
  const failure = await rpc('command/exec', {
    command: ['powershell.exe', '-NoProfile', '-Command', 'exit 7'],
    cwd: home,
    timeoutMs: 10000,
    sandboxPolicy: { type: 'dangerFullAccess' },
  });
  assert.equal(failure.exitCode, 7);
  await rpc('thread/archive', { threadId: started.thread.id });
  console.log(
    'PASS: selected engine initialize, full access, native tool execution + filesystem change + model feedback loop, Responses stream, resume, terminal success/failure, archive. No production API used.',
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

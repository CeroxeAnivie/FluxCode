import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const model = 'flux-fixture';
const home = resolve(root, 'work', `subagent-smoke-${Date.now()}`);
await mkdir(home, { recursive: true });
const identity = await readFile(resolve(root, 'config/agent/BASE_INSTRUCTIONS.md'), 'utf8');
const fixture = createServer();
let inferenceRequests = 0;
let parentStep = 0;
const parentPayloads = [];
const call = (name, args, id) => ({
  type: 'function_call',
  id: `fc_${id}`,
  call_id: `call_${id}`,
  namespace: 'collaboration',
  name,
  arguments: JSON.stringify(args),
});
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
    assert.equal(req.headers.authorization, 'Bearer fixture-not-a-real-secret');
    for (const item of body.input ?? []) {
      if (item.type !== 'message') continue;
      assert.ok(
        !(item.content ?? []).some((part) => part.type === 'encrypted_content'),
        'Collaboration instructions must reach child inference as plaintext',
      );
    }
    const users = body.input.filter((item) => item.type === 'message' && item.role === 'user');
    const isParent = users.some((item) => JSON.stringify(item).includes('FLUX_PARENT_FIXTURE'));
    if (isParent) parentPayloads.push(body);
    else
      await writeFile(
        resolve(home, `child-request-${inferenceRequests}.json`),
        JSON.stringify(body),
        'utf8',
      );
    inferenceRequests++;
    if (inferenceRequests === 1) {
      await writeFile(resolve(home, 'request.json'), JSON.stringify(body, null, 2), 'utf8');
      const names = body.tools.flatMap((tool) => tool.tools ?? [tool]).map((tool) => tool.name);
      for (const name of [
        'spawn_agent',
        'send_message',
        'followup_task',
        'interrupt_agent',
        'list_agents',
        'wait_agent',
      ])
        assert.ok(names.includes(name), name);
      assert.match(body.instructions, /FluxCode/);
      assert.doesNotMatch(body.instructions, /codex/i);
    }
    let items;
    if (isParent) {
      const step = parentStep++;
      if (step === 0)
        items = Array.from({ length: 8 }, (_, index) =>
          call(
            'spawn_agent',
            {
              task_name: `worker_${index}`,
              message: `FLUX_CHILD_FIXTURE_${index}: report to parent`,
              fork_turns: 'none',
            },
            `spawn_${index}`,
          ),
        );
      else if (step === 1) items = [call('list_agents', {}, 'list')];
      else if (step === 2)
        items = [
          call(
            'send_message',
            { target: 'worker_0', message: 'PARENT_MESSAGE_FIXTURE' },
            'message',
          ),
        ];
      else if (step === 3) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        items = [call('interrupt_agent', { target: 'worker_0' }, 'interrupt')];
      } else if (step === 4)
        items = [
          call(
            'followup_task',
            { target: 'worker_0', message: 'FOLLOWUP_FIXTURE: finish the task' },
            'followup',
          ),
        ];
      else if (step === 5) items = [call('wait_agent', { timeout_ms: 1000 }, 'wait')];
    } else if (
      !body.input.some((item) => item.type === 'function_call' && item.name === 'send_message')
    ) {
      items = [
        call(
          'send_message',
          { target: '/root', message: 'CHILD_REPORT_FIXTURE' },
          `child_message_${inferenceRequests}`,
        ),
      ];
    }
    if (!items)
      items = [
        {
          type: 'message',
          id: `answer_${inferenceRequests}`,
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: isParent ? 'Parent output verified.' : 'Child output verified.',
              annotations: [],
            },
          ],
        },
      ];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (type, rest) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`);
    emit('response.created', {
      response: { id: `response_${inferenceRequests}`, status: 'in_progress', output: [] },
    });
    for (const [index, item] of items.entries()) {
      const meta = { output_index: index, item_id: item.id };
      const tool = item.type === 'function_call';
      emit('response.output_item.added', {
        output_index: index,
        item: tool ? { ...item, arguments: '' } : { ...item, content: [] },
      });
      if (tool) {
        emit('response.function_call_arguments.delta', { ...meta, delta: item.arguments });
        emit('response.function_call_arguments.done', { ...meta, arguments: item.arguments });
      } else {
        emit('response.content_part.added', {
          ...meta,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        });
        emit('response.output_text.delta', {
          ...meta,
          content_index: 0,
          delta: item.content[0].text,
        });
        emit('response.output_text.done', {
          ...meta,
          content_index: 0,
          text: item.content[0].text,
        });
      }
      emit('response.output_item.done', { output_index: index, item });
    }
    emit('response.completed', {
      response: {
        id: `response_${inferenceRequests}`,
        status: 'completed',
        output: items,
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      },
    });
    res.end();
  } catch (error) {
    console.error(error);
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
await writeFile(
  resolve(home, 'fluxcode.toml'),
  (await readFile(resolve(root, 'config/fluxcode.example.toml'), 'utf8'))
    .replace('https://api.openai.com/v1', 'http://127.0.0.1:' + fixture.address().port + '/v1')
    .replace(/^model = .*$/m, 'model = "' + model + '"')
    .replace(/^api_key_env = .*$/m, 'api_key_env = "FLUX_FIXTURE_KEY"'),
  'utf8',
);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const child = spawn(
  process.env.FLUXCODE_CLI_BIN || resolve(root, 'src-tauri/target/debug/fluxcode-cli.exe'),
  ['--data-dir', home],
  {
    windowsHide: true,
    env: {
      ...process.env,
      CODEX_HOME: home,
      ...(proxy
        ? {
            HTTP_PROXY: proxy,
            HTTPS_PROXY: proxy,
            ALL_PROXY: proxy,
            NO_PROXY: '127.0.0.1,localhost',
            no_proxy: '127.0.0.1,localhost',
          }
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
    capabilities: { experimentalApi: true },
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
    input: [{ type: 'text', text: 'FLUX_PARENT_FIXTURE: delegate this task.', text_elements: [] }],
  });
  const deadline = Date.now() + 45000;
  while (
    !events.some(
      (event) => event.method === 'turn/completed' && event.params.threadId === started.thread.id,
    ) &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  const childIds = [
    ...new Set(
      events
        .filter(
          (event) =>
            event.params?.threadId === started.thread.id &&
            event.params?.item?.type === 'subAgentActivity' &&
            event.params.item.kind === 'started',
        )
        .map((event) => event.params.item.agentThreadId),
    ),
  ];
  assert.equal(
    childIds.length,
    8,
    'All eight children must be created beyond the previous default cap',
  );
  const histories = [];
  for (const id of childIds) {
    let history;
    do {
      history = await rpc('thread/read', { threadId: id, includeTurns: true });
      if (JSON.stringify(history).includes('Child output verified.')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.match(JSON.stringify(history), /Child output verified\./);
    const page = await rpc('thread/items/list', {
      threadId: id,
      limit: 100,
      sortDirection: 'desc',
    });
    assert.ok(
      page.data.some(
        (row) => row.item.type === 'agentMessage' && row.item.text === 'Child output verified.',
      ),
    );
    histories.push(history);
  }
  const descendants = await rpc('thread/list', {
    ancestorThreadId: started.thread.id,
    sourceKinds: ['subAgentThreadSpawn'],
    limit: 100,
    useStateDbOnly: true,
  });
  assert.equal(descendants.data.length, 8);
  const modelResume = await rpc('thread/resume', {
    threadId: started.thread.id,
    model,
    modelProvider: 'fluxcode',
    excludeTurns: true,
    deferGoalContinuation: true,
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    baseInstructions: identity,
    config: { model_catalog_json: resolve(home, 'engine-home', 'model-catalog.json') },
  });
  assert.equal(modelResume.thread.id, started.thread.id);
  assert.doesNotMatch(JSON.stringify(parentPayloads[0].tools), /codex/i);
  const outputs = parentPayloads
    .at(-1)
    .input.filter((item) => item.type === 'function_call_output');
  for (const name of ['message', 'interrupt', 'followup', 'list']) {
    const output = outputs.find((item) => item.call_id === `call_${name}`);
    assert.ok(output, `Missing ${name} result`);
    assert.doesNotMatch(
      JSON.stringify(output),
      /not found|not supported|invalid|AgentLimitReached/i,
    );
  }
  assert.ok(
    JSON.stringify(parentPayloads).includes('CHILD_REPORT_FIXTURE'),
    'Child report must arrive at the parent',
  );
  assert.ok(
    histories.some((history) => history.thread.turns.length >= 2),
    'Follow-up wakes an interrupted or idle child',
  );
  await writeFile(
    resolve(home, 'result.json'),
    JSON.stringify({ histories, events, outputs, parentPayloads }, null, 2),
    'utf8',
  );
  console.log(
    'PASS: eight native children; parent messaging, interrupt, follow-up, list and wait; child-to-parent feedback; history pagination; FluxCode system identity. Evidence:',
    home,
  );
} catch (error) {
  await writeFile(resolve(home, 'diagnostics.log'), diagnostics, 'utf8');
  console.error(error);
  await writeFile(resolve(home, 'events.json'), JSON.stringify(events, null, 2), 'utf8');
  console.error('Fixture-only diagnostics:', home);
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

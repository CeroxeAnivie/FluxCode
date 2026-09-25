import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const executable = resolve(root, 'src-tauri/target/debug/fluxcode.exe');
const data = resolve(root, 'work', `native-backup-${Date.now()}`);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const proxyEnv = proxy
  ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: '', no_proxy: '' }
  : {};
const firstTask = '备份前的真实历史任务';
const secondTask = '备份后的真实历史任务';
let releaseHeldResponse;
let responseCount = 0;

function sendResponse(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const item = {
    id: `native-backup-message-${++responseCount}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  const emit = (type, fields) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  emit('response.created', {
    response: { id: `response-${responseCount}`, status: 'in_progress', output: [] },
  });
  emit('response.output_item.added', {
    output_index: 0,
    item: { ...item, status: 'in_progress', content: [] },
  });
  emit('response.output_text.delta', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: text,
  });
  emit('response.output_item.done', { output_index: 0, item });
  emit('response.completed', {
    response: {
      id: `response-${responseCount}`,
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
      .end(JSON.stringify({ data: [{ id: 'native-backup-fixture' }] }));
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
    assert.equal(request.model, 'native-backup-fixture');
    assert.equal(request.stream, true);
    if (JSON.stringify(request.input).includes(secondTask)) {
      await new Promise((resolve) => {
        releaseHeldResponse = () => {
          sendResponse(res, '第二段历史已完成。');
          resolve();
        };
      });
    } else {
      sendResponse(res, '第一段历史已保存。');
    }
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

async function connectDesktop(port) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const page = browser.contexts()[0]?.pages()[0];
      if (page) {
        page.setDefaultTimeout(20000);
        return { browser, page };
      }
      await browser.close();
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Native WebView2 did not open: ${lastError}`);
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

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Desktop restart timed out')), 30000);
    child.once('exit', () => {
      clearTimeout(timeout);
      done();
    });
  });
}

async function waitForFileGone(path) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await access(path);
    } catch {
      return;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Recovery marker was not cleared: ${path}`);
}

async function assertNoSqliteSidecars(snapshot) {
  const names = await readdir(resolve(snapshot, 'payload', 'engine-home'), { recursive: true });
  assert.deepEqual(
    names.filter((name) => /\.sqlite-(?:wal|shm)$/.test(name)),
    [],
    'A published snapshot must contain only complete SQLite database files',
  );
}

await access(executable);
await mkdir(data, { recursive: true });
await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
const debugPort = await freeLocalPort();
const webviewArguments = [
  `--remote-debugging-port=${debugPort}`,
  '--remote-debugging-address=127.0.0.1',
  ...(proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>'] : []),
].join(' ');
const desktopEnv = {
  ...process.env,
  FLUXCODE_TEST_DATA_DIR: data,
  WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webviewArguments,
  ...proxyEnv,
};
let desktop = spawn(executable, [], { windowsHide: true, env: desktopEnv, stdio: 'ignore' });
let browser;
let page;

try {
  ({ browser, page } = await connectDesktop(debugPort));
  await page.getByRole('heading', { name: '让想法，在代码中发生。' }).waitFor();
  await page.evaluate((path) => {
    localStorage.setItem(
      'fluxcode.catalog.v1',
      JSON.stringify({
        version: 1,
        projects: [{ id: 'backup-project', name: 'FluxCode', path }],
        tasks: [],
      }),
    );
  }, root);
  await page.reload();
  await page.getByRole('button', { name: 'README.md', exact: true }).waitFor();
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page
    .getByLabel('服务地址', { exact: true })
    .fill(`http://127.0.0.1:${fixture.address().port}/v1`);
  await page.getByLabel('访问密钥', { exact: true }).fill('native-backup-fixture-key');
  await page.getByLabel('渠道名称', { exact: false }).fill('Native backup fixture');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  await page.getByRole('textbox', { name: '任务描述' }).fill(firstTask);
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByText('第一段历史已保存。', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '停止任务' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const backups = page.locator('.backup-settings');
  await backups.getByRole('button', { name: '立即备份' }).click();
  await backups.getByText('备份已完成并保存在本机。', { exact: false }).waitFor();
  await backups.locator('.backup-entry').first().waitFor();
  const original = (await invoke(page, 'list_backups'))[0];
  assert.ok(original.id);
  assert.ok(original.fileCount > 2);
  const snapshot = resolve(data, 'backups', original.id);
  await assertNoSqliteSidecars(snapshot);
  assert.match(await readFile(resolve(snapshot, 'manifest.toml'), 'utf8'), /schema_version = 1/);
  const savedUi = JSON.parse(await readFile(resolve(snapshot, 'payload/ui-state.json'), 'utf8'));
  assert.ok(savedUi['fluxcode.catalog.v1'].includes(firstTask));
  await backups.getByRole('button', { name: '详情' }).click();
  await backups.getByText('尚未校验', { exact: true }).waitFor();
  await backups.locator('.backup-files li').first().waitFor();
  assert.ok((await backups.locator('.backup-files li').count()) > 2);
  await backups.getByRole('button', { name: '校验' }).click();
  await backups.getByText('校验通过', { exact: true }).waitFor();
  await assertNoSqliteSidecars(snapshot);

  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('不能丢失的待发送内容');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await backups.getByRole('button', { name: '恢复' }).isDisabled(), true);
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('');

  assert.match(
    await rejection(page, 'request_backup_restore', {
      id: original.id,
      uiState: { 'fluxcode.queue.v1': '[{}]' },
    }),
    /待发送消息/,
  );
  assert.match(
    await rejection(page, 'request_backup_restore', {
      id: original.id,
      uiState: { 'fluxcode.editor-drafts.v1': '{"file":{"text":"unsaved"}}' },
    }),
    /未保存的文件编辑/,
  );

  await page.getByRole('textbox', { name: '任务描述' }).fill(secondTask);
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('button', { name: '停止任务' }).waitFor();
  for (let attempt = 0; !releaseHeldResponse && attempt < 40; attempt++)
    await new Promise((done) => setTimeout(done, 250));
  assert.ok(releaseHeldResponse, 'The second turn must reach the local Responses fixture');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await backups.getByRole('button', { name: '立即备份' }).isDisabled(), true);
  assert.equal(await backups.getByRole('button', { name: '恢复' }).isDisabled(), true);
  assert.match(
    await rejection(page, 'request_backup_restore', { id: original.id, uiState: {} }),
    /正在运行/,
  );
  await page.getByRole('button', { name: '关闭设置' }).click();
  releaseHeldResponse();
  releaseHeldResponse = undefined;
  await page.getByText('第二段历史已完成。', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '停止任务' }).waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await backups.getByRole('button', { name: '立即备份' }).click();
  await backups.locator('.backup-entry').nth(1).waitFor();
  const damaged = (await invoke(page, 'list_backups')).find((item) => item.id !== original.id);
  assert.ok(damaged);
  const damagedPayload = resolve(data, 'backups', damaged.id, 'payload', 'ui-state.json');
  await writeFile(damagedPayload, '{}', 'utf8');
  const damagedEntry = backups.locator('.backup-entry').first();
  await damagedEntry.getByRole('button', { name: '详情' }).click();
  await damagedEntry.getByRole('button', { name: '校验' }).click();
  await damagedEntry.getByText('校验失败', { exact: true }).waitFor();
  assert.match(await rejection(page, 'verify_backup', { id: damaged.id }), /校验失败/);
  assert.equal((await invoke(page, 'list_backups')).length, 2);
  await backups.locator('.backup-entry').last().getByRole('button', { name: '恢复' }).click();
  await backups.getByRole('button', { name: '确认恢复并重启' }).click();
  await waitForExit(desktop);
  await browser.close().catch(() => {});
  ({ browser, page } = await connectDesktop(debugPort));
  await page.getByRole('button', { name: firstTask, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: secondTask, exact: true }).count(), 0);
  await page.getByRole('button', { name: firstTask, exact: true }).click();
  await page.getByText('第一段历史已保存。', { exact: true }).first().waitFor();
  await waitForFileGone(resolve(data, 'restore-unconfirmed.toml'));
  await waitForFileGone(resolve(data, 'restore-ui.json'));
  await waitForFileGone(resolve(data, 'pending-restore.toml'));
  const backupsAfterRestore = await invoke(page, 'list_backups');
  assert.equal(
    backupsAfterRestore.length,
    3,
    'Recovery must preserve the current-state safety backup',
  );
  const safety = backupsAfterRestore.find((item) => ![original.id, damaged.id].includes(item.id));
  assert.ok(safety);
  const safetyUi = JSON.parse(
    await readFile(resolve(data, 'backups', safety.id, 'payload/ui-state.json'), 'utf8'),
  );
  assert.ok(safetyUi['fluxcode.catalog.v1'].includes(firstTask));
  const safetySessions = resolve(data, 'backups', safety.id, 'payload', 'engine-home', 'sessions');
  const sessionFiles = (await readdir(safetySessions, { recursive: true })).filter((name) =>
    name.endsWith('.jsonl'),
  );
  assert.ok(
    (
      await Promise.all(sessionFiles.map((name) => readFile(resolve(safetySessions, name), 'utf8')))
    ).some((content) => content.includes(secondTask)),
    'The safety backup must preserve the more recent engine conversation',
  );
  await assertNoSqliteSidecars(resolve(data, 'backups', safety.id));
  assert.ok(
    (await readdir(resolve(data, 'engine-home'))).some((name) => /^state_\d+\.sqlite$/.test(name)),
  );
  await invoke(page, 'forget_api_key', { settings: await invoke(page, 'load_settings') });
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  console.log(
    `PASS: real WebView2 backup, verification, blockers, corruption, safety snapshot, restart and history recovery (${data})`,
  );
} catch (error) {
  if (page) {
    const copyDiagnostic = page.getByRole('button', { name: '复制诊断信息' }).last();
    if (await copyDiagnostic.isVisible().catch(() => false)) {
      await copyDiagnostic.click().catch(() => {});
      const diagnostic = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          '$utf8=[System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=$utf8; $OutputEncoding=$utf8; Get-Clipboard',
        ],
        { encoding: 'utf8', timeout: 5000 },
      );
      console.error(
        'Native diagnostic:',
        diagnostic.status === 0 ? diagnostic.stdout.trim() : 'Clipboard unavailable',
      );
    }
    console.error(
      (
        await page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(-4000),
    );
    await page.screenshot({ path: resolve(data, 'native-backup-failure.png') }).catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  releaseHeldResponse?.();
  await page
    ?.getByRole('button', { name: '关闭窗口', exact: true })
    .click({ timeout: 1000 })
    .catch(() => {});
  await browser?.close().catch(() => {});
  if (desktop.exitCode === null) desktop.kill();
  fixture.closeAllConnections();
  await new Promise((done) => fixture.close(done));
}

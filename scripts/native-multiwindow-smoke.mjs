import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const data = resolve(root, 'work', `native-multiwindow-${Date.now()}`);
await mkdir(data, { recursive: true });
const otherProject = resolve(data, 'isolated-project');
await mkdir(otherProject, { recursive: true });
let requests = 0;
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ id: 'native-fixture' }] }));
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
  JSON.parse(bytes.toString('utf8'));
  requests++;
  const id = `reply-${requests}`;
  const item = {
    id,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Window task completed.', annotations: [] }],
  };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, payload) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
  event('response.created', { response: { id, status: 'in_progress', output: [] } });
  event('response.output_item.added', {
    output_index: 0,
    item: { ...item, status: 'in_progress', content: [] },
  });
  setTimeout(() => {
    if (res.destroyed) return;
    event('response.output_text.delta', {
      item_id: id,
      output_index: 0,
      content_index: 0,
      delta: 'Window task completed.',
    });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', {
      response: {
        id,
        status: 'completed',
        output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    });
    res.end();
  }, 400);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const env = {
  ...process.env,
  FLUXCODE_TEST_DATA_DIR: data,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
    '--remote-debugging-port=0',
    ...(proxy
      ? [`--proxy-server=${new URL(proxy).origin}`, '--proxy-bypass-list=<-loopback>']
      : []),
  ].join(' '),
};
delete env.WEBVIEW2_USER_DATA_FOLDER;
let child = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
  env,
  windowsHide: true,
  stdio: 'ignore',
});
const browsers = new Map();
async function pageFor(fragment) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const files = await readdir(resolve(data, 'webview'), { recursive: true }).catch(() => []);
    for (const file of files.filter((name) => name.endsWith('DevToolsActivePort'))) {
      const port = Number(
        (await readFile(resolve(data, 'webview', file), 'utf8')).split(/\r?\n/)[0],
      );
      if (!browsers.has(port)) {
        try {
          browsers.set(port, await chromium.connectOverCDP(`http://127.0.0.1:${port}`));
        } catch {
          continue;
        }
      }
      for (const page of browsers
        .get(port)
        .contexts()
        .flatMap((context) => context.pages())) {
        if (
          fragment
            ? page.url().includes(fragment)
            : page.url().includes('tauri.localhost') && !page.url().includes('workspace=')
        ) {
          page.setDefaultTimeout(15000);
          return page;
        }
      }
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Native window did not become available: ${fragment || 'main'}`);
}
try {
  const main = await pageFor();
  await main.getByRole('heading', { name: '让想法，在代码中发生。' }).waitFor();
  await main.evaluate(
    async ({ path, other }) => {
      const store = await window.__TAURI_INTERNALS__.invoke('load_ui_state');
      await window.__TAURI_INTERNALS__.invoke('save_ui_state', {
        expectedGeneration: store?.generation ?? null,
        values: {
          ...(store?.values ?? {}),
          'fluxcode.catalog.v1': JSON.stringify({
            version: 1,
            projects: [
              { id: 'multi-project', name: 'Multiwindow', path },
              { id: 'isolated-project', name: 'Isolated', path: other },
            ],
            tasks: [],
          }),
        },
      });
    },
    { path: root, other: otherProject },
  );
  await main.reload();
  await main.getByRole('button', { name: '渠道管理', exact: true }).click();
  await main.getByRole('button', { name: '添加渠道', exact: true }).click();
  await main
    .getByLabel('服务地址', { exact: true })
    .fill(`http://127.0.0.1:${server.address().port}/v1`);
  await main.getByLabel('访问密钥', { exact: true }).fill('fixture-only-not-a-secret');
  await main.getByLabel('渠道名称', { exact: false }).fill('Multiwindow fixture');
  await main.getByRole('button', { name: '导入并使用', exact: true }).click();
  await main.getByRole('dialog').waitFor({ state: 'hidden' });
  await main.getByRole('textbox', { name: '任务描述' }).fill('main-private-draft');
  await main.getByRole('button', { name: '在新窗口打开工作区' }).click();
  const first = await pageFor('workspace=workspace-1');
  const duplicate = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  await expect.poll(() => duplicate.exitCode, { timeout: 15000 }).toBe(0);
  await expect(first.getByRole('textbox', { name: '任务描述' })).toHaveValue('');
  await first.getByRole('textbox', { name: '任务描述' }).fill('from-window-one');
  await first.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(first.locator('.assistant-message')).toContainText('Window task completed.');
  await expect(main.getByRole('button', { name: 'from-window-one', exact: true })).toBeVisible();
  await expect(main.getByRole('textbox', { name: '任务描述' })).toHaveValue('main-private-draft');
  await first.getByRole('textbox', { name: '任务描述' }).fill('child-private-draft');
  await first.getByRole('button', { name: '在新窗口打开工作区' }).click();
  const second = await pageFor('workspace=workspace-2');
  await expect(second.getByRole('button', { name: 'from-window-one', exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'from-window-one', exact: true }).click();
  await expect(second.locator('.assistant-message')).toContainText('Window task completed.');
  await expect(second.getByRole('textbox', { name: '任务描述' })).toHaveValue('');
  await second.getByRole('textbox', { name: '任务描述' }).fill('from-window-two');
  await second.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(first.locator('.user-message').last()).toContainText('from-window-two');
  await expect(second.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
  assert.equal(requests, 2, 'one engine request per send');
  await second.getByRole('combobox', { name: '项目', exact: true }).click();
  await second.locator('.select-item[data-value="isolated-project"]').click();
  await second.getByRole('textbox', { name: '任务描述' }).fill('isolated-workspace-task');
  await second.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(second.locator('.assistant-message')).toContainText('Window task completed.');
  await expect
    .poll(() =>
      second.evaluate(() => JSON.parse(localStorage.getItem('fluxcode.workspace.v1')).taskId),
    )
    .toBeTruthy();
  const cwd = await second.evaluate(async () => {
    const threadId = JSON.parse(localStorage.getItem('fluxcode.workspace.v1')).taskId;
    const { thread } = await window.__TAURI_INTERNALS__.invoke('engine_rpc', {
      method: 'thread/read',
      params: { threadId },
    });
    return thread.cwd;
  });
  assert.equal(
    cwd.replaceAll('\\', '/').toLowerCase(),
    otherProject.replaceAll('\\', '/').toLowerCase(),
  );
  await second.getByRole('combobox', { name: '项目', exact: true }).click();
  await second.locator('.select-item[data-value="multi-project"]').click();
  await second.getByRole('button', { name: 'from-window-one', exact: true }).click();
  await first.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect.poll(() => first.isClosed()).toBe(true);
  await main.getByRole('button', { name: '在新窗口打开工作区' }).click();
  const reopened = await pageFor('workspace=workspace-1');
  await expect(reopened.getByRole('textbox', { name: '任务描述' })).toHaveValue(
    'child-private-draft',
  );
  await reopened.getByRole('button', { name: '切换终端', exact: true }).click();
  await expect(reopened.locator('.xterm-helper-textarea')).toBeVisible();
  await second.evaluate((cwd) => {
    window.fixtureCommand = window.__TAURI_INTERNALS__
      .invoke('execute_terminal', {
        cwd,
        command: 'Start-Sleep -Seconds 120',
        processId: 'fixture-other-window-command',
      })
      .then(
        () => 'finished',
        () => 'failed',
      );
  }, root);
  await expect
    .poll(() =>
      second.evaluate(
        async () =>
          (await window.__TAURI_INTERNALS__.invoke('runtime_resource_usage')).windowResources
            .terminalSessions,
      ),
    )
    .toBe(2);
  await main.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await reopened.getByRole('textbox', { name: '任务描述' }).fill('after-main-hidden');
  await reopened.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(second.locator('.user-message').last()).toContainText('after-main-hidden');
  await expect(reopened.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
  await reopened.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect.poll(() => reopened.isClosed()).toBe(true);
  await expect
    .poll(() =>
      second.evaluate(
        async () =>
          (await window.__TAURI_INTERNALS__.invoke('runtime_resource_usage')).windowResources
            .terminalSessions,
      ),
    )
    .toBe(1);
  await second.evaluate(async () => {
    await window.__TAURI_INTERNALS__.invoke('engine_rpc', {
      method: 'command/exec/terminate',
      params: { processId: 'fixture-other-window-command' },
    });
    await window.fixtureCommand;
  });
  await expect
    .poll(() =>
      second.evaluate(
        async () =>
          (await window.__TAURI_INTERNALS__.invoke('runtime_resource_usage')).windowResources
            .terminalSessions,
      ),
    )
    .toBe(0);
  if (process.argv.includes('--crash-recovery')) {
    assert.equal(child.kill(), true, 'Terminate the host without its normal close path');
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
    for (const browser of browsers.values()) await browser.close().catch(() => {});
    browsers.clear();
    child = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
      env,
      windowsHide: true,
      stdio: 'ignore',
    });
    const restored = await pageFor();
    await expect(restored.getByRole('textbox', { name: '任务描述' })).toHaveValue(
      'main-private-draft',
    );
    await restored.getByRole('button', { name: 'from-window-one', exact: true }).click();
    await expect(restored.locator('.user-message').last()).toContainText('after-main-hidden');
    await expect(restored.locator('.assistant-message').last()).toContainText(
      'Window task completed.',
    );
    assert.equal(requests, 4, 'restart must not replay conversation requests');
    await restored.getByRole('button', { name: '关闭窗口', exact: true }).click();
  } else {
    await second.getByRole('button', { name: '关闭窗口', exact: true }).click();
  }
  await expect.poll(() => child.exitCode, { timeout: 15000 }).toBe(0);
  assert.equal(requests, 4, 'shared and isolated tasks each execute exactly once');
  await writeFile(
    resolve(data, 'result.json'),
    JSON.stringify({
      result: 'passed',
      requests,
      crashRecovery: process.argv.includes('--crash-recovery'),
    }),
    'utf8',
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      data,
      requests,
      crashRecovery: process.argv.includes('--crash-recovery'),
      coverage: [
        'shared tasks',
        'independent drafts',
        'reopen recovery',
        'hidden owner',
        'terminal close',
        'other-window command survives',
        'single instance',
        'independent project cwd',
        'last window exit',
      ],
    }),
  );
} catch (error) {
  console.error(String(error));
  for (const browser of browsers.values())
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      console.error(
        'resources',
        await page
          .evaluate(async () => {
            const d = await window.__TAURI_INTERNALS__.invoke('runtime_resource_usage');
            return { engine: d.engineResources, windows: d.windowResources };
          })
          .catch(() => null),
      );
      console.error(
        page.url(),
        (
          await page
            .locator('body')
            .innerText()
            .catch(() => '')
        ).slice(-5000),
      );
    }
  throw error;
} finally {
  if (child.exitCode === null)
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  for (const browser of browsers.values()) await browser.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}

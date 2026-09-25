import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'work', `performance-${Date.now()}`);
const dist = resolve(output, 'dist');
const taskCount = 2500;
const rootFileCount = 1500;
const directoryDepth = 12;
const historyCount = 2000;
const longFileLines = 8000;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  return port;
}

async function startPreview(port) {
  const child = spawn(
    process.execPath,
    [
      resolve(root, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
      '--outDir',
      dist,
    ],
    { cwd: root, windowsHide: true, stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return child;
    } catch {
      // Local preview is still starting.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  child.kill();
  throw new Error('Performance preview failed to start');
}

async function settle(page) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

async function measure(page, label, action, ready) {
  // Navigation replaces the page's time origin; use one monotonic host clock.
  const before = performance.now();
  await action();
  await ready();
  await settle(page);
  const after = performance.now();
  return { label, ms: Math.round((after - before) * 10) / 10 };
}

async function memory(cdp, page) {
  await cdp.send('HeapProfiler.collectGarbage');
  const metrics = (await cdp.send('Performance.getMetrics')).metrics;
  const counters = await cdp.send('Memory.getDOMCounters');
  const heap = metrics.find((entry) => entry.name === 'JSHeapUsedSize')?.value;
  return {
    jsHeapMiB: heap == null ? null : Math.round((heap / 1048576) * 10) / 10,
    domNodes: counters.nodes,
    documentCount: counters.documents,
    visibleTaskRows: await page.locator('.sidebar .task-select').count(),
  };
}

await mkdir(output, { recursive: true });
const build = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'test', '--outDir', dist],
  { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true },
);
if (build.status !== 0) throw new Error(`Fixture build failed: ${build.stderr || build.stdout}`);
const port = await freePort();
let server;
let browser;
try {
  server = await startPreview(port);
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  browser = await chromium.launch({
    headless: true,
    ...(proxy ? { proxy: { server: proxy, bypass: '<-loopback>' } } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(
    ({ taskCount, rootFileCount, directoryDepth, historyCount, longFileLines }) => {
      const tasks = Array.from({ length: taskCount }, (_, index) => ({
        id: `task-${index}`,
        projectId: 'performance-project',
        title: `Task ${String(index).padStart(4, '0')}`,
        updatedAt: taskCount - index,
        archived: false,
      }));
      localStorage.setItem(
        'fluxcode.catalog.v1',
        JSON.stringify({
          version: 1,
          projects: [{ id: 'performance-project', name: 'Performance fixture', path: 'C:\\perf' }],
          tasks,
        }),
      );
      const listeners = new Set();
      window.__PERF_EMIT__ = (event) => listeners.forEach((listener) => listener(event));
      const sampleItems = (count) =>
        Array.from({ length: count }, (_, index) => ({
          id: `history-${index}`,
          type: 'agentMessage',
          text: `History message ${index}`,
        }));
      window.__FLUX_TEST_BRIDGE__ = {
        available: true,
        subscribe: async (handler) => {
          listeners.add(handler);
          return () => listeners.delete(handler);
        },
        loadSettings: async () => ({
          baseUrl: 'https://example.invalid/v1',
          model: 'fixture-model',
          apiKeyEnv: 'PERFORMANCE_FIXTURE_KEY',
          proxyUrl: '',
        }),
        listProviderProfiles: async () => [],
        loadPreferences: async () => ({
          font_size: 14,
          sidebar_width: 246,
          inspector_width: 294,
        }),
        connect: async () => ({ version: 'fixture' }),
        listFiles: async (_root, relative) => {
          const depth = relative ? relative.split('/').length : 0;
          if (depth) {
            return [
              ...(depth < directoryDepth
                ? [
                    {
                      name: `level-${depth}`,
                      path: `${relative}/level-${depth}`,
                      directory: true,
                    },
                  ]
                : []),
              { name: 'deep.txt', path: `${relative}/deep.txt`, directory: false },
            ];
          }
          return [
            { name: 'level-0', path: 'level-0', directory: true },
            { name: 'long.ts', path: 'long.ts', directory: false },
            ...Array.from({ length: rootFileCount }, (_, index) => ({
              name: `file-${index}.ts`,
              path: `file-${index}.ts`,
              directory: false,
            })),
          ];
        },
        readFile: async () =>
          Array.from(
            { length: longFileLines },
            (_, index) => `const line${index} = '${'x'.repeat(64)}';`,
          ).join('\n'),
        saveFile: async () => {},
        repoStatus: async () => ({ branch: '', changes: [], git: false }),
        searchWorkspace: async () => ({ hits: [], truncated: false }),
        rpc: async (method, params) => {
          const count = params.threadId === 'task-2499' ? historyCount : 2;
          if (method === 'thread/read' || method === 'thread/resume') {
            return {
              thread: {
                historyMode: 'legacy',
                turns: [{ id: 'turn-0', status: 'completed', items: sampleItems(count) }],
              },
            };
          }
          return {};
        },
      };
    },
    { taskCount, rootFileCount, directoryDepth, historyCount, longFileLines },
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const timings = [];
  const startup = await measure(
    page,
    'catalogStartup',
    () => page.goto(`http://127.0.0.1:${port}/`),
    () => page.getByRole('button', { name: 'Task 0000', exact: true }).waitFor(),
  );
  timings.push(startup);
  const initialMemory = await memory(cdp, page);

  const searchDurations = [];
  for (let index = 0; index < 5; index++) {
    const search = page.getByRole('textbox', { name: '搜索任务' });
    const sample = await measure(
      page,
      'taskFilter',
      () => search.fill('Task 2499'),
      () => page.getByRole('button', { name: 'Task 2499', exact: true }).waitFor(),
    );
    searchDurations.push(sample.ms);
    await search.fill('');
    await page.getByRole('button', { name: 'Task 0000', exact: true }).waitFor();
  }
  timings.push({ label: 'taskFilterMedian', ms: median(searchDurations) });

  timings.push(
    await measure(
      page,
      'channelOpen',
      () => page.getByRole('button', { name: '渠道管理', exact: true }).first().click(),
      () => page.getByRole('dialog', { name: '渠道管理' }).waitFor(),
    ),
  );
  await page
    .getByRole('dialog', { name: '渠道管理' })
    .getByRole('button', { name: '关闭渠道管理' })
    .click();

  await page.getByRole('textbox', { name: '搜索任务' }).fill('Task 2499');
  timings.push(
    await measure(
      page,
      'longHistoryLoad',
      () => page.getByRole('button', { name: 'Task 2499', exact: true }).click(),
      () => page.getByText('History message 1999', { exact: true }).waitFor(),
    ),
  );
  const historyMemory = await memory(cdp, page);
  assert.ok((await page.locator('.assistant-message').count()) < 60);
  await page.getByRole('textbox', { name: '搜索任务' }).fill('');
  timings.push(
    await measure(
      page,
      'taskSwitch',
      () => page.getByRole('button', { name: 'Task 0001', exact: true }).click(),
      () => page.getByText('History message 1', { exact: true }).waitFor(),
    ),
  );

  timings.push(
    await measure(
      page,
      'deepDirectoryNavigation',
      async () => {
        for (let depth = 0; depth < directoryDepth; depth++) {
          await page
            .locator(
              `.file-row[data-path="${Array.from({ length: depth + 1 }, (_, i) => `level-${i}`).join('/')}"]`,
            )
            .click();
        }
      },
      () => page.locator('.file-row[data-path$="deep.txt"]').waitFor(),
    ),
  );

  await page.locator('.file-row[data-path="long.ts"]').count();
  for (let depth = 0; depth < directoryDepth; depth++) {
    await page.getByRole('button', { name: '上一级' }).click();
  }
  timings.push(
    await measure(
      page,
      'longFileOpen',
      () => page.locator('.file-row[data-path="long.ts"]').click(),
      () => page.getByRole('button', { name: '编辑', exact: true }).waitFor(),
    ),
  );
  timings.push(
    await measure(
      page,
      'longFileEditor',
      () => page.getByRole('button', { name: '编辑', exact: true }).click(),
      () => page.locator('.cm-editor').waitFor(),
    ),
  );
  const fileMemory = await memory(cdp, page);
  await page.locator('.file-editor').getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '搜索对话正文' }).click();
  const conversationSearch = page.getByRole('dialog', { name: '搜索对话正文' });
  await conversationSearch.getByRole('textbox', { name: '搜索词' }).fill('absent-benchmark-term');
  timings.push(
    await measure(
      page,
      'conversationSearchNoHit',
      () => conversationSearch.getByRole('button', { name: '搜索', exact: true }).click(),
      () => conversationSearch.getByText('没有匹配的消息').waitFor(),
    ),
  );
  await conversationSearch.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('textbox', { name: '搜索任务' }).fill('Task 2499');
  await page.getByRole('button', { name: 'Task 2499', exact: true }).click();
  await page.locator('.conversation-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByText('History message 1999', { exact: true }).waitFor();
  const emission = await page.evaluate(() => {
    const start = performance.now();
    window.__PERF_EMIT__({
      method: 'turn/started',
      params: { threadId: 'task-2499', turn: { id: 'stream-turn' } },
    });
    for (let index = 0; index < 500; index++) {
      window.__PERF_EMIT__({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'task-2499',
          itemId: 'stream-output',
          delta: index === 499 ? 'STREAM_COMPLETE' : 'stream data ',
        },
      });
    }
    return { start, emitted: performance.now() };
  });
  await page.getByText(/STREAM_COMPLETE/).waitFor();
  await settle(page);
  const painted = await page.evaluate(() => performance.now());
  timings.push({ label: 'stream500Deltas', ms: Math.round((painted - emission.start) * 10) / 10 });
  timings.push({
    label: 'streamFinalPaint',
    ms: Math.round((painted - emission.emitted) * 10) / 10,
  });
  const streamingMemory = await memory(cdp, page);
  assert.ok((await page.locator('.assistant-message').count()) < 60);

  const report = {
    generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, node: process.version, browser: browser.version() },
    fixture: { taskCount, rootFileCount, directoryDepth, historyCount, longFileLines },
    timings,
    memory: {
      afterStartup: initialMemory,
      afterHistory: historyMemory,
      afterLongFile: fileMemory,
      afterStreaming: streamingMemory,
    },
  };
  await writeFile(resolve(output, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server?.exitCode === null) server.kill();
}

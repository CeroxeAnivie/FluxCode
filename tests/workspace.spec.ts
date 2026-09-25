import { expect, test } from '@playwright/test';

test('browser panel docks, resizes, remembers width, hides below dialogs and restores focus', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__FLUX_TEST_BROWSER__ = {
      command: async (action) => {
        const calls = JSON.parse(localStorage.getItem('fixture-browser-actions') ?? '[]');
        calls.push(action);
        localStorage.setItem('fixture-browser-actions', JSON.stringify(calls));
      },
      subscribe: async () => () => {},
    };
  });
  await page.reload();
  await setup(page);
  await page.getByRole('button', { name: '打开浏览器', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '应用内浏览器' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: '网页地址' })).toBeFocused();
  await panel.getByRole('textbox', { name: '网页地址' }).fill('https://example.test/guide');
  await panel.getByRole('textbox', { name: '网页地址' }).press('Enter');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-browser-actions')))
    .toContain('navigate');
  const boundary = page.getByRole('separator', { name: '调整浏览器宽度' });
  const initial = Number(await boundary.getAttribute('aria-valuenow'));
  await boundary.focus();
  await boundary.press('ArrowLeft');
  await expect(boundary).toHaveAttribute('aria-valuenow', String(initial + 24));
  const box = (await boundary.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 55, box.y + 100, { steps: 5 });
  await page.mouse.up();
  const savedWidth = await boundary.getAttribute('aria-valuenow');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fluxcode.browser-width.v1')))
    .toBe(savedWidth);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('fixture-browser-actions') ?? '[]').at(-1)?.visible,
      ),
    )
    .toBe(false);
  await page.keyboard.press('Escape');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('fixture-browser-actions') ?? '[]').at(-1)?.visible,
      ),
    )
    .toBe(true);
  await panel.getByRole('button', { name: '关闭浏览器' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开浏览器', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '打开浏览器', exact: true }).click();
  await expect(boundary).toHaveAttribute('aria-valuenow', savedWidth!);
  await page.screenshot({ path: 'test-results/browser-panel.png' });
});

test('Markdown links reuse the browser panel and unsafe addresses stay blocked', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__FLUX_TEST_BROWSER__ = {
      command: async (action) => {
        if (action.kind === 'navigate') localStorage.setItem('fixture-browser-url', action.url);
      },
      subscribe: async () => () => {},
    };
  });
  await page.reload();
  await setup(page);
  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('[文档](https://example.test/docs) [帮助](https://example.test/help)');
  await input.press('Enter');
  const firstLink = page.locator('.user-message').getByRole('link', { name: '文档', exact: true });
  await firstLink.click();
  await expect(page.getByRole('complementary', { name: '应用内浏览器' })).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-browser-url')))
    .toBe('https://example.test/docs');
  await page.locator('.user-message').getByRole('link', { name: '帮助', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-browser-url')))
    .toBe('https://example.test/help');
  const address = page.getByRole('textbox', { name: '网页地址' });
  await address.fill('javascript:alert(1)');
  await address.press('Enter');
  await expect(page.getByRole('alert')).toContainText('网页链接无效');
  expect(await page.evaluate(() => localStorage.getItem('fixture-browser-url'))).toBe(
    'https://example.test/help',
  );
  await page.getByRole('button', { name: '关闭浏览器' }).click();
  await expect(firstLink).toBeFocused();
});

test('browser panel gives recoverable failures and English controls', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'fluxcode.appearance.v1',
      JSON.stringify({ language: 'en', theme: 'light' }),
    );
    window.__FLUX_TEST_BROWSER__ = {
      command: async (action) => {
        if (action.kind === 'navigate') throw new Error('fixture navigation failure');
      },
      subscribe: async () => () => {},
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open browser', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'In-app browser' });
  const address = panel.getByRole('textbox', { name: 'Web address' });
  await address.fill('https://example.test');
  await address.press('Enter');
  await expect(panel.getByRole('alert')).toContainText(
    'The browser operation failed. Please try again.',
  );
  expect(await panel.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await expect(panel.getByRole('button', { name: 'Open in default browser' })).toBeEnabled();
  await page.evaluate(() => {
    window.__FLUX_TEST_BROWSER__!.command = async (action) => {
      if (action.kind === 'navigate') localStorage.setItem('browser-retried', action.url);
    };
  });
  await panel.getByRole('button', { name: 'Reload page' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('browser-retried')))
    .toBe('https://example.test/');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 960, height: 720 });
  const rect = (await panel.boundingBox())!;
  expect(rect.x + rect.width).toBeLessThanOrEqual(960);
  await expect(page.getByRole('textbox', { name: 'Task description' })).toBeVisible();
  await address.dispatchEvent('compositionstart');
  await address.fill('https://example.test/ime');
  await address.press('Enter');
  expect(await page.evaluate(() => localStorage.getItem('browser-retried'))).toBe(
    'https://example.test/',
  );
  await address.dispatchEvent('compositionend');
  await address.press('Enter');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('browser-retried')))
    .toBe('https://example.test/ime');
  await panel.getByRole('button', { name: 'Close browser' }).click();
  await expect(panel).toHaveCount(0);
});

test('browser panel preserves an open editor and the file button returns to it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__FLUX_TEST_BROWSER__ = {
      command: async () => {},
      subscribe: async () => () => {},
    };
  });
  await page.reload();
  await setup(page);
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
  await editor.fill('保留未保存的编辑现场');
  await page.getByRole('button', { name: '打开浏览器', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: '切换文件面板', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '应用内浏览器' })).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('保留未保存的编辑现场');
  await editor.press('Control+z');
  await expect(editor).toContainText('Sample project');
});

test('workspace storage failure keeps drafts, exports without clearing and retries', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith('fluxcode.workspace') &&
        localStorage.getItem('fixture-disk-failure') === 'yes'
      )
        throw new DOMException('Disk unavailable', 'QuotaExceededError');
      original.call(this, key, value);
    };
    localStorage.setItem('fixture-disk-failure', 'yes');
  });
  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('不能丢失的草稿');
  await expect(page.getByText('草稿仍保留在内存中，请重试保存或另存后再退出。')).toBeVisible();
  await page.getByRole('button', { name: '另存全部草稿' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-export')))
    .toContain('不能丢失的草稿');
  await expect(input).toHaveValue('不能丢失的草稿');
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.exportDocument = async () => false;
  });
  await page.getByRole('button', { name: '另存全部草稿' }).click();
  await expect(input).toHaveValue('不能丢失的草稿');
  await page.evaluate(() => localStorage.removeItem('fixture-disk-failure'));
  await page.getByRole('button', { name: '重试保存草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '另存全部草稿' })).toHaveCount(0);
  await page.reload();
  await expect(input).toHaveValue('不能丢失的草稿');
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Event = { method: string; params?: Record<string, unknown> };
    const listeners = new Set<(e: Event) => void>();
    const emit = (e: Event) => listeners.forEach((listener) => listener(e));
    const settings = {
      baseUrl: 'https://example.com/v1',
      model: 'fixture-model',
      apiKeyEnv: 'TEST_KEY',
      proxyUrl: '',
    };
    let counter = 0;
    window.__FLUX_TEST_BRIDGE__ = {
      available: true,
      inspectDroppedPaths: async (paths) => paths.map((path) => ({ path, kind: 'file' as const })),
      previewAttachment: async () =>
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9PihEAAAAASUVORK5CYII=',
      openWorkspaceFile: async (root, relative) => {
        localStorage.setItem('fixture-open-workspace-file', JSON.stringify({ root, relative }));
      },
      searchWorkspace: async () => ({
        hits: [{ path: 'src/main.ts', line: 1, preview: 'matching code' }],
        truncated: false,
      }),
      answerElicitation: async (id, answer) => {
        localStorage.setItem('fixture-elicitation-answer', JSON.stringify({ id, answer }));
      },
      listSchedules: async () => JSON.parse(localStorage.getItem('fixture-schedules') ?? '[]'),
      saveSchedule: async (job) => {
        const rows = JSON.parse(localStorage.getItem('fixture-schedules') ?? '[]').filter(
          (r: { id: string }) => r.id !== job.id,
        );
        localStorage.setItem(
          'fixture-schedules',
          JSON.stringify([
            ...rows,
            { ...job, nextRun: Date.now() / 1000 + job.intervalMinutes * 60 },
          ]),
        );
      },
      removeSchedule: async (id) => {
        const rows = JSON.parse(localStorage.getItem('fixture-schedules') ?? '[]').filter(
          (r: { id: string }) => r.id !== id,
        );
        localStorage.setItem('fixture-schedules', JSON.stringify(rows));
      },
      diagnostics: async () => ({ schemaVersion: 1 }),
      installSkill: async (source) => source,
      exportDocument: async (name, content) => {
        localStorage.setItem('fixture-export', JSON.stringify({ name, content }));
        return true;
      },
      readDocument: async () => null,
      decodeProviderProfiles: async (text) => JSON.parse(text).profiles,
      encodeProviderProfiles: async (profiles) => JSON.stringify({ schema_version: 1, profiles }),
      saveProviderProfile: async (profile, previousName, expected) => {
        const rows = JSON.parse(localStorage.getItem('fixture-profiles') ?? '[]');
        if (JSON.stringify(rows) !== JSON.stringify(expected)) throw new Error('stale profiles');
        const next = [
          ...rows.filter((row: { name: string }) => row.name !== previousName),
          profile,
        ];
        localStorage.setItem('fixture-profiles', JSON.stringify(next));
        return next;
      },
      listProviderProfiles: async () =>
        JSON.parse(localStorage.getItem('fixture-profiles') ?? '[]'),
      saveProviderProfiles: async (rows) => {
        localStorage.setItem('fixture-profiles', JSON.stringify(rows));
      },
      discoverProvider: async () => ({ models: ['fixture-model', 'other-model'], latencyMs: 12 }),
      loadSettings: async () =>
        JSON.parse(localStorage.getItem('fixture-settings') ?? JSON.stringify(settings)),
      loadPreferences: async () => ({
        font_size: Number(localStorage.getItem('fixture-font-size') ?? 14),
        sidebar_width: Number(localStorage.getItem('fixture-sidebar-width') ?? 246),
        inspector_width: Number(localStorage.getItem('fixture-inspector-width') ?? 294),
      }),
      saveFontSize: async (size) => {
        localStorage.setItem('fixture-font-size', String(size));
      },
      savePanelWidth: async (panel, width) => {
        localStorage.setItem(`fixture-${panel}-width`, String(width));
      },
      openTerminal: async () => ({ exitCode: 0 }),
      answerAgent: async (id, answers) => {
        localStorage.setItem('fixture-agent-answer', JSON.stringify({ id, answers }));
      },
      connect: async (value) => {
        localStorage.setItem('fixture-settings', JSON.stringify(value));
        return { version: '0.156.1' };
      },
      forgetApiKey: async () => {},
      openUserFile: async () => {},
      subscribe: async (handler) => {
        listeners.add(handler);
        return () => {
          listeners.delete(handler);
        };
      },
      chooseDirectory: async () => {
        localStorage.setItem('fixture-picker-language', document.documentElement.lang);
        return 'D:\\Fixtures\\sample-project';
      },
      chooseAttachments: async () => [],
      listFiles: async (_root, relative) =>
        relative
          ? [{ name: 'main.ts', path: 'src/main.ts', directory: false }]
          : [
              { name: 'src', path: 'src', directory: true },
              { name: 'README.md', path: 'README.md', directory: false },
            ],
      readFile: async () =>
        localStorage.getItem('fixture-file') ?? '# Sample project\nUTF-8 中文预览',
      saveFile: async (_root, _path, expected, content) => {
        const current = localStorage.getItem('fixture-file') ?? '# Sample project\nUTF-8 中文预览';
        if (expected !== current) throw new Error('The file changed on disk');
        localStorage.setItem('fixture-file', content);
      },
      listCheckpoints: async () => [],
      gitAction: async () => '',
      gitBranches: async () => ({ current: 'main', branches: ['main'] }),
      gitOperation: async () => ({ kind: null, conflicts: [], dirty: false }),
      gitConflictVersions: async () => ({
        base: 'base\n',
        current: 'current\n',
        incoming: 'incoming\n',
        working: localStorage.getItem('fixture-file') ?? '# Sample project\nUTF-8 中文预览',
      }),
      listMcpDefinitions: async () => [],
      saveMcpDefinition: async () => {},
      repoStatus: async () => ({
        branch: 'main',
        git: true,
        changes: [{ path: 'src/main.ts', status: ' M' }],
      }),
      fileDiff: async (_root, _relative, staged) =>
        staged
          ? ''
          : 'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n',
      executeTerminal: async (_cwd, command, processId) => {
        emit({
          method: 'command/exec/outputDelta',
          params: { processId, deltaBase64: btoa('terminal-ok\n') },
        });
        return { exitCode: command === 'fail' ? 1 : 0, stdout: '', stderr: '' };
      },
      rpc: async <T>(method: string, params: object): Promise<T> => {
        if (method === 'command/exec/resize') {
          const calls = JSON.parse(localStorage.getItem('fixture-terminal-resizes') ?? '[]');
          calls.push(params);
          localStorage.setItem('fixture-terminal-resizes', JSON.stringify(calls));
        }
        if (method === 'turn/start') {
          localStorage.setItem('fixture-last-turn', JSON.stringify(params));
          localStorage.setItem(
            'fixture-turn-count',
            String(Number(localStorage.getItem('fixture-turn-count') ?? 0) + 1),
          );
        }
        const p = params as Record<string, unknown>;
        if (method === 'fixture/event') {
          emit(p as unknown as Event);
          return {} as T;
        }
        if (method === 'thread/list' && localStorage.getItem('fixture-resume-fail') === 'true')
          throw new Error('睡眠恢复后通路不可用');
        if (method === 'thread/compact/start') {
          if (localStorage.getItem('fixture-compact-fail'))
            throw new Error('fixture compaction rejected');
          const threadId = p.threadId;
          emit({ method: 'turn/started', params: { threadId, turn: { id: 'compact-turn' } } });
          emit({
            method: 'item/started',
            params: { threadId, item: { type: 'contextCompaction', id: 'compact-item' } },
          });
          setTimeout(() => {
            emit({
              method: 'item/completed',
              params: { threadId, item: { type: 'contextCompaction', id: 'compact-item' } },
            });
            emit({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId,
                tokenUsage: {
                  total: { totalTokens: 9000 },
                  last: { inputTokens: 1000, totalTokens: 1200 },
                  modelContextWindow: 4000,
                },
              },
            });
            emit({
              method: 'turn/completed',
              params: { threadId, turn: { id: 'compact-turn', status: 'completed' } },
            });
          }, 300);
          return {} as T;
        }
        if (method === 'thread/fork') return { thread: { id: `fork-${++counter}` } } as T;
        if (method === 'thread/start') return { thread: { id: `thread-${++counter}` } } as T;
        if (method === 'thread/read')
          return {
            thread: {
              historyMode: 'legacy',
              turns: [
                {
                  id: 'turn-search',
                  status: 'completed',
                  items: [
                    { id: 'u-old', type: 'userMessage', content: [{ text: '历史任务' }] },
                    { id: 'a-old', type: 'agentMessage', text: '恢复成功' },
                  ],
                },
              ],
            },
          } as T;
        if (method === 'thread/resume')
          return {
            thread: {
              historyMode: 'legacy',
              turns: [
                {
                  id: 'turn-old',
                  status: localStorage.getItem('fixture-ambiguous') ? 'inProgress' : 'completed',
                  items: localStorage.getItem('fixture-long-history')
                    ? Array.from({ length: 2000 }, (_, index) => ({
                        id: `history-${index}`,
                        type: 'agentMessage',
                        text: `History message ${index}`,
                      }))
                    : [
                        { id: 'u-old', type: 'userMessage', content: [{ text: '历史任务' }] },
                        { id: 'a-old', type: 'agentMessage', text: '恢复成功' },
                      ],
                },
              ],
            },
          } as T;
        if (method === 'turn/start') {
          const threadId = p.threadId;
          const text = (p.input as { text: string }[])[0].text;
          if (text === 'accepted-but-timeout') {
            localStorage.setItem('fixture-ambiguous', 'true');
            throw new Error('Request timed out');
          }
          if (text === 'trigger-failure') throw new Error('模拟服务不可用');
          emit({ method: 'turn/started', params: { threadId, turn: { id: 'turn-1' } } });
          emit({
            method: 'item/completed',
            params: { threadId, item: { type: 'userMessage', id: 'u-1', content: [{ text }] } },
          });
          if (text === 'parallel-question')
            emit({
              method: 'engine/userInput',
              params: {
                id: `question-${threadId}`,
                threadId,
                turnId: 'turn-1',
                questions: [
                  {
                    id: 'choice',
                    header: '部署目标',
                    question: '选择部署目标',
                    isSecret: false,
                    options: null,
                  },
                ],
              },
            });
          if (text === 'parallel-form')
            emit({
              method: 'engine/elicitation',
              params: {
                id: `form-${threadId}`,
                threadId,
                turnId: 'turn-1',
                serverName: 'Fixture',
                mode: 'form',
                message: '填写表单',
                requestedSchema: {
                  properties: {
                    name: { type: 'string', title: '发布名称' },
                    enabled: { type: 'boolean', title: '启用部署' },
                    count: { type: 'integer', title: '发布数量' },
                  },
                  required: ['name', 'enabled'],
                },
              },
            });
          if (!['long-running', 'parallel-question', 'parallel-form'].includes(text))
            setTimeout(
              () => {
                emit({
                  method: 'item/agentMessage/delta',
                  params: { threadId, itemId: 'a-1', delta: '任务完成，已验证。' },
                });
                emit({
                  method: 'item/completed',
                  params: {
                    threadId,
                    item: { type: 'agentMessage', id: 'a-1', text: '任务完成，已验证。' },
                  },
                });
                emit({
                  method: 'turn/completed',
                  params: {
                    threadId,
                    turn:
                      text === 'stream-failure'
                        ? {
                            id: 'turn-1',
                            status: 'failed',
                            error: { message: 'Streaming response interrupted' },
                          }
                        : { id: 'turn-1', status: 'completed' },
                  },
                });
              },
              text === 'stream-failure' ? 500 : 50,
            );
          return { turn: { id: 'turn-1' } } as T;
        }
        if (method === 'turn/interrupt')
          emit({
            method: 'turn/completed',
            params: { threadId: p.threadId, turn: { id: p.turnId, status: 'interrupted' } },
          });
        return {} as T;
      },
    };
  });
  await page.goto('/');
});

test('catalog write failure protects unsaved tasks, exports recovery data and retries', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith('fluxcode.catalog.v1') &&
        localStorage.getItem('fixture-catalog-full') === 'true'
      )
        throw new DOMException('Disk full', 'QuotaExceededError');
      original.call(this, key, value);
    };
    localStorage.setItem('fixture-catalog-full', 'true');
  });
  await page.getByRole('textbox', { name: '任务描述' }).fill('索引写入失败后必须保留的任务');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await expect(page.getByRole('button', { name: '另存全部草稿' })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.getByRole('button', { name: '另存全部草稿' }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(JSON.parse(localStorage.getItem('fixture-export')!).content).catalog.tasks[0]
          .title,
    ),
  ).toBe('索引写入失败后必须保留的任务');
  await page.evaluate(() => localStorage.removeItem('fixture-catalog-full'));
  await page.getByRole('button', { name: '重试保存草稿' }).click();
  await expect(page.getByRole('button', { name: '另存全部草稿' })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('button', { name: '索引写入失败后必须保留的任务', exact: true }),
  ).toBeVisible();
});

async function setup(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('large directory keeps bounded rows and keyboard access to every file with preview focus recovery', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.listFiles = async () =>
      Array.from({ length: 1500 }, (_, i) => ({
        name: `file-${i}.ts`,
        path: `file-${i}.ts`,
        directory: false,
      }));
  });
  await setup(page);
  const first = page.getByRole('button', { name: 'file-0.ts', exact: true });
  await first.focus();
  await first.press('End');
  const last = page.getByRole('button', { name: 'file-1499.ts', exact: true });
  await expect(last).toBeFocused();
  expect(await page.locator('.file-row').count()).toBeLessThan(60);
  await last.press('Enter');
  await page.getByRole('button', { name: '返回文件列表' }).click();
  await expect(last).toBeFocused();
  await last.press('Home');
  await expect(first).toBeFocused();
});

test('keyboard reaches offscreen tasks in a large virtualized sidebar', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const catalog = JSON.parse(localStorage.getItem('fluxcode.catalog.v1')!);
    catalog.tasks = Array.from({ length: 500 }, (_, i) => ({
      id: `key-${i}`,
      projectId: catalog.projects[0].id,
      title: `Keyboard task ${i}`,
      updatedAt: 500 - i,
      archived: false,
    }));
    localStorage.setItem('fluxcode.catalog.v1', JSON.stringify(catalog));
  });
  await page.reload();
  const first = page.getByRole('button', { name: 'Keyboard task 0', exact: true });
  await first.focus();
  await first.press('End');
  const last = page.getByRole('button', { name: 'Keyboard task 499', exact: true });
  await expect(last).toBeFocused();
  expect(await page.locator('.task-select').count()).toBeLessThan(60);
  await last.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Keyboard task 498', exact: true })).toBeFocused();
});

test('settings load on demand without hiding the workspace or losing its draft', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('设置加载期间保留的草稿');
  expect(requests.some((url) => /\/SettingsDialog-[^/]+\.js/.test(url))).toBe(false);
  let release!: () => void;
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/SettingsDialog-*.js', async (route) => {
    await loading;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.locator('.loading-overlay')).toBeVisible();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('设置加载期间保留的草稿');
  } finally {
    release();
  }
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(input).toHaveValue('设置加载期间保留的草稿');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  expect(requests.filter((url) => /\/SettingsDialog-[^/]+\.js/.test(url))).toHaveLength(1);
});

test('closing settings does not steal focus from the next chosen input', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).evaluate(async (button) => {
    (button as HTMLButtonElement).click();
    await Promise.resolve();
    const input = document.querySelector<HTMLTextAreaElement>('.composer textarea')!;
    input.focus();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  const input = page.getByRole('textbox', { name: '任务描述' });
  await expect(input).toBeFocused();
  await input.fill('long-running');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
});

test('workspaces rename, close and reopen without deleting history or drafts', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('workspace history');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.getByRole('button', { name: '新建任务 Ctrl N', exact: true }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('工作区未发送草稿');
  await page.getByRole('button', { name: '工作区管理', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '工作区管理' });
  await dialog.getByRole('button', { name: '修改名称' }).click();
  await dialog.getByRole('textbox', { name: '工作区名称', exact: true }).fill('我的工作区');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('listitem')).toContainText('我的工作区');
  await dialog.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await expect(dialog.getByText('已关闭', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.sidebar .task-select')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '工作区管理', exact: true }).click();
  await dialog.getByRole('button', { name: '重新打开', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('工作区未发送草稿');
  await expect(page.getByRole('button', { name: 'workspace history', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'workspace history', exact: true }).click();
  await expect(page.locator('.assistant-message')).toContainText('恢复成功');
});

test('created worktree opens as an independent workspace with source ownership', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '变更1', exact: true }).click();
  await page.getByText('分支与工作树', { exact: true }).click();
  await page.getByRole('textbox', { name: '新分支名称' }).fill('feature-worktree');
  await page.getByRole('textbox', { name: '新工作树绝对路径' }).fill('D:/fixture-independent');
  await page.getByRole('button', { name: '创建工作树', exact: true }).click();
  await page.getByRole('button', { name: '打开工作树', exact: true }).click();
  await page.getByRole('button', { name: '工作区管理', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '工作区管理' });
  await expect(dialog.getByRole('listitem')).toHaveCount(2);
  await expect(
    dialog.getByRole('listitem').filter({ hasText: 'D:/fixture-independent' }),
  ).toContainText('来源工作区');
  const projects = await page.evaluate(
    () => JSON.parse(localStorage.getItem('fluxcode.catalog.v1')!).projects,
  );
  expect(projects[1].worktreeParentId).toBe(projects[0].id);
  expect(projects[1].path).not.toBe(projects[0].path);
});

test('workspace close refuses active tasks and retains its searchable entry', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.getByRole('button', { name: '停止任务' })).toBeVisible();
  await page.getByRole('button', { name: '工作区管理', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '工作区管理' });
  await dialog.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('请先停止此工作区中的运行任务。');
  await dialog.getByRole('textbox', { name: '搜索名称或路径' }).fill('not-found');
  await expect(dialog.getByText('没有匹配的工作区')).toBeVisible();
  await dialog.getByRole('button', { name: '清除搜索' }).click();
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '工作区管理', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: '停止任务' })).toBeVisible();
});

test('parallel task questions retain unsent answers across switches and route to the correct request', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.getByRole('button', { name: '停止任务' })).toBeVisible();
  await page.getByRole('button', { name: '新建任务 Ctrl N', exact: true }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('parallel-question');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('textbox', { name: '部署目标', exact: true }).fill('保持这个回答');
  await page.getByRole('button', { name: 'long-running', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '部署目标', exact: true })).toHaveCount(0);
  await expect(page.locator('.user-message')).toContainText('long-running');
  await page.getByRole('button', { name: '任务总览', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '任务总览' });
  await expect(dialog.getByRole('status')).toContainText('等待输入 1');
  await dialog.getByRole('button', { name: /parallel-question/ }).click();
  await expect(page.getByRole('textbox', { name: '部署目标', exact: true })).toHaveValue(
    '保持这个回答',
  );
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('fixture-agent-answer') ?? '{}')),
    )
    .toEqual({ id: 'question-thread-2', answers: { choice: { answers: ['保持这个回答'] } } });
  await expect(page.getByRole('textbox', { name: '部署目标', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'long-running', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止任务' })).toBeVisible();
});

test('engine disconnect exposes uncertain tasks without replaying their requests', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.getByRole('button', { name: '停止任务' })).toBeVisible();
  await page.evaluate(() =>
    window.__FLUX_TEST_BRIDGE__!.rpc('fixture/event', {
      method: 'engine/disconnected',
      params: {},
    }),
  );
  await expect(page.getByRole('button', { name: '停止任务' })).toHaveCount(0);
  await expect(page.getByText('连接已断开，请确认执行状态后重试。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '任务总览', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '任务总览' }).getByRole('status')).toContainText(
    '失败 1',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.assistant-message')).toContainText('恢复成功');
  expect(await page.evaluate(() => localStorage.getItem('fixture-turn-count'))).toBe('1');
});

test('idle foreground resume probes the engine and offers reconnect', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    localStorage.setItem('fixture-resume-fail', 'true');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('alert')).toContainText('无法连接，请检查服务地址、代理和网络。');
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('fixture-resume-fail'));
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByText('执行引擎已就绪', { exact: true })).toBeVisible();
});

test('failed foreground probe releases uncertain task UI and requires review of queued work', async ({
  page,
}) => {
  await setup(page);
  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('long-running');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await input.fill('resume-must-not-replay');
  await input.press('Enter');
  await expect(page.locator('.queued-messages')).toContainText('resume-must-not-replay');
  await page.evaluate(() => {
    localStorage.setItem('fixture-resume-fail', 'true');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
  await expect(page.locator('.queued-messages')).toContainText(
    '连接已断开，请确认执行状态后重试。',
  );
  await page.evaluate(() => localStorage.removeItem('fixture-resume-fail'));
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByText('执行引擎已就绪', { exact: true })).toBeVisible();
  await expect(page.locator('.queued-messages')).toContainText('resume-must-not-replay');
  expect(await page.evaluate(() => localStorage.getItem('fixture-turn-count'))).toBe('1');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.queued-messages')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('fixture-turn-count'))).toBe('2');
});

test('foreground recovery settles a missed failure without sending queued work', async ({
  page,
}) => {
  await setup(page);
  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('parallel-question');
  await input.press('Enter');
  await expect(page.getByRole('textbox', { name: '部署目标', exact: true })).toBeVisible();
  await input.fill('retain-after-missed-failure');
  await input.press('Enter');
  await expect(page.locator('.queued-messages')).toContainText('retain-after-missed-failure');
  await page.evaluate(() => {
    const original = window.__FLUX_TEST_BRIDGE__!.rpc;
    window.__FLUX_TEST_BRIDGE__!.rpc = async (method, params) => {
      if (method === 'thread/turns/list')
        return {
          data: [
            {
              id: 'turn-1',
              status: 'failed',
              items: [
                { id: 'recovered-answer', type: 'agentMessage', text: 'Recovered final output' },
              ],
              error: { message: 'Connection interrupted' },
            },
          ],
          nextCursor: null,
        } as never;
      return original(method, params);
    };
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('textbox', { name: '部署目标', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
  await expect(page.locator('.assistant-message')).toContainText('Recovered final output');
  await expect(page.locator('.queued-messages')).toContainText('任务已停止，请确认后继续发送。');
  expect(await page.evaluate(() => localStorage.getItem('fixture-turn-count'))).toBe('1');
});

test('a stale foreground probe cannot disconnect a newly connected engine', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const original = window.__FLUX_TEST_BRIDGE__!.rpc;
    let rejectProbe: ((error: Error) => void) | undefined;
    window.__FLUX_TEST_BRIDGE__!.rpc = async (method, params) => {
      if (method === 'thread/list' && !rejectProbe) {
        localStorage.setItem('fixture-probe-pending', 'true');
        return new Promise((_, reject) => {
          rejectProbe = reject;
        });
      }
      if (method === 'fixture/reject-probe') {
        rejectProbe?.(new Error('obsolete connection failure'));
        return {} as never;
      }
      return original(method, params);
    };
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-probe-pending')))
    .toBe('true');
  await page.evaluate(() =>
    window.__FLUX_TEST_BRIDGE__!.rpc('fixture/event', {
      method: 'engine/disconnected',
      params: {},
    }),
  );
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByText('执行引擎已就绪', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await window.__FLUX_TEST_BRIDGE__!.rpc('fixture/reject-probe', {});
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(page.getByText('执行引擎已就绪', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toHaveCount(0);
});

for (const language of ['zh-CN', 'en'] as const) {
  test(`diagnostic copy announces success and failure in ${language}`, async ({ page }) => {
    await setup(page);
    await page.evaluate((language) => {
      localStorage.setItem('fluxcode.appearance.v1', JSON.stringify({ language, theme: 'dark' }));
    }, language);
    await page.reload();
    await expect(
      page.getByRole('button', { name: language === 'en' ? 'Settings' : '设置', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {} },
      });
      localStorage.setItem('fixture-resume-fail', 'true');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const notice = page.locator('.error-notice').first();
    const copy = notice.getByRole('button');
    await expect(copy).toHaveText(language === 'en' ? 'Copy diagnostics' : '复制诊断信息');
    await copy.focus();
    await page.keyboard.press('Enter');
    await expect(notice.getByRole('status')).toHaveText(language === 'en' ? 'Copied' : '已复制');
    await expect(notice.getByRole('alert')).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('clipboard unavailable');
          },
        },
      });
    });
    await copy.click();
    await expect(notice.getByRole('status')).toHaveText(
      language === 'en' ? 'Copy failed' : '复制失败',
    );
  });
}

test('service form drafts survive task switches and preserve unchecked booleans', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('parallel-form');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('textbox', { name: '发布名称' }).fill('发布草稿');
  await page.getByRole('spinbutton', { name: '发布数量' }).fill('2');
  await page.getByRole('spinbutton', { name: '发布数量' }).fill('');
  await page.evaluate(() =>
    window.__FLUX_TEST_BRIDGE__!.rpc('fixture/event', {
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'older-turn', status: 'completed' } },
    }),
  );
  await expect(page.getByRole('textbox', { name: '发布名称' })).toHaveValue('发布草稿');
  await page.getByRole('button', { name: '新建任务 Ctrl N', exact: true }).click();
  await page.getByRole('button', { name: 'parallel-form', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '发布名称' })).toHaveValue('发布草稿');
  await expect(page.getByRole('checkbox', { name: '启用部署' })).not.toBeChecked();
  await expect(page.getByRole('spinbutton', { name: '发布数量' })).toHaveValue('');
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('fixture-elicitation-answer') ?? '{}')),
    )
    .toEqual({
      id: 'form-thread-1',
      answer: { action: 'accept', content: { name: '发布草稿', enabled: false }, _meta: null },
    });
});

test('standalone service requests survive unrelated completion until explicitly resolved', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('parallel-form');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.evaluate(() =>
    window.__FLUX_TEST_BRIDGE__!.rpc('fixture/event', {
      method: 'engine/elicitation',
      params: {
        id: 'form-thread-1',
        threadId: 'thread-1',
        turnId: null,
        serverName: 'Fixture',
        mode: 'form',
        message: '独立表单',
        requestedSchema: {
          properties: { name: { type: 'string', title: '发布名称' } },
          required: ['name'],
        },
      },
    }),
  );
  await page.getByRole('textbox', { name: '发布名称' }).fill('独立请求草稿');
  await page.evaluate(() =>
    window.__FLUX_TEST_BRIDGE__!.rpc('fixture/event', {
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
    }),
  );
  await expect(page.getByRole('textbox', { name: '发布名称' })).toHaveValue('独立请求草稿');
  await page.evaluate(() =>
    window.__FLUX_TEST_BRIDGE__!.rpc('fixture/event', {
      method: 'serverRequest/resolved',
      params: { threadId: 'thread-1', requestId: 'form-thread-1' },
    }),
  );
  await expect(page.getByRole('textbox', { name: '发布名称' })).toHaveCount(0);
});

test('failed connection health clears obsolete interaction IDs before reconnect', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('parallel-form');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('textbox', { name: '发布名称' }).fill('连接内的临时回答');
  await page.evaluate(() => {
    localStorage.setItem('fixture-resume-fail', 'true');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('textbox', { name: '发布名称' })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('fixture-resume-fail'));
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByText('执行引擎已就绪', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交回答', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('fixture-elicitation-answer'))).toBeNull();
});

test('late answer acknowledgement cannot dismiss a new connection request with the same ID', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    let finish: (() => void) | undefined;
    const rpc = window.__FLUX_TEST_BRIDGE__!.rpc;
    window.__FLUX_TEST_BRIDGE__!.answerElicitation = async () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        localStorage.setItem('fixture-answer-pending', 'true');
      });
    window.__FLUX_TEST_BRIDGE__!.rpc = async (method, params) => {
      if (method === 'fixture/finish-answer') {
        finish?.();
        return {} as never;
      }
      return rpc(method, params);
    };
  });
  await page.getByRole('textbox', { name: '任务描述' }).fill('parallel-form');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('textbox', { name: '发布名称' }).fill('旧连接回答');
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-answer-pending')))
    .toBe('true');
  await page.evaluate(() =>
    window.__FLUX_TEST_BRIDGE__!.rpc('fixture/event', {
      method: 'engine/disconnected',
      params: {},
    }),
  );
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByText('执行引擎已就绪', { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.__FLUX_TEST_BRIDGE__!.rpc('fixture/event', {
      method: 'engine/elicitation',
      params: {
        id: 'form-thread-1',
        threadId: 'thread-1',
        turnId: 'new-turn',
        serverName: 'Fixture',
        mode: 'form',
        message: '新连接表单',
        requestedSchema: {
          properties: { name: { type: 'string', title: '发布名称' } },
          required: ['name'],
        },
      },
    }),
  );
  await page.getByRole('textbox', { name: '发布名称' }).fill('新连接回答');
  await page.evaluate(async () => {
    await window.__FLUX_TEST_BRIDGE__!.rpc('fixture/finish-answer', {});
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(page.getByRole('textbox', { name: '发布名称' })).toHaveValue('新连接回答');
});

test('task activity bounds a large list, searches projects and restores keyboard focus in English', async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem(
      'fluxcode.appearance.v1',
      JSON.stringify({ language: 'en', theme: 'light' }),
    );
    localStorage.setItem(
      'fluxcode.catalog.v1',
      JSON.stringify({
        version: 1,
        projects: [{ id: 'fixture-project', name: 'Activity project', path: 'D:/fixture' }],
        tasks: Array.from({ length: 75 }, (_, index) => ({
          id: `activity-${index}`,
          projectId: 'fixture-project',
          title: `Task ${index}`,
          updatedAt: index,
          archived: false,
        })),
      }),
    );
  });
  await page.reload();
  const trigger = page.getByRole('button', { name: 'Task activity', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Task activity' });
  await expect(dialog.getByRole('textbox', { name: 'Search tasks or projects' })).toBeFocused();
  await expect(dialog.getByRole('listitem')).toHaveCount(50);
  await dialog.getByRole('button', { name: 'Show more tasks' }).click();
  await expect(dialog.getByRole('listitem')).toHaveCount(75);
  await dialog.getByRole('textbox').fill('Activity project');
  await expect(dialog.getByRole('listitem')).toHaveCount(50);
  expect(await dialog.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('task activity stops only its target and permits retry after failure', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.getByRole('button', { name: '停止任务' })).toBeVisible();
  await page.getByRole('button', { name: '新建任务 Ctrl N', exact: true }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('second task');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.evaluate(() => {
    const bridge = window.__FLUX_TEST_BRIDGE__!;
    const original = bridge.rpc.bind(bridge);
    let failed = false;
    bridge.rpc = async (method, params) => {
      if (method === 'turn/interrupt') {
        localStorage.setItem('fixture-interrupt-target', JSON.stringify(params));
        if (!failed) {
          failed = true;
          throw new Error('模拟服务不可用');
        }
      }
      return original(method, params);
    };
  });
  await page.getByRole('button', { name: '任务总览', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '任务总览' });
  await expect(dialog.getByText('运行中 1', { exact: false })).toBeVisible();
  const running = dialog.getByRole('listitem').filter({ hasText: 'long-running' });
  await running.getByRole('button', { name: '停止任务' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await running.getByRole('button', { name: '停止任务' }).click();
  await expect(running.getByRole('button', { name: '停止任务' })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('fixture-interrupt-target')!).threadId),
    )
    .toBe('thread-1');
  await dialog.getByRole('textbox', { name: '搜索任务或项目' }).fill('not-found');
  await expect(dialog.getByText('没有匹配的任务')).toBeVisible();
  await dialog.getByRole('button', { name: '清除搜索' }).click();
  await running.getByRole('button').click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.user-message')).toContainText('long-running');
});

async function installNativeBackupFixture(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    let callbackId = 0;
    const callbacks = new Map<number, (...args: unknown[]) => void>();
    const eventListeners = new Map<number, { event: string; handler: number }>();
    const emit = (event: string, payload: Record<string, unknown>) => {
      for (const [id, listener] of eventListeners) {
        if (listener.event === event)
          callbacks.get(listener.handler)?.({ id, event, payload, windowLabel: 'main' });
      }
    };
    const settings = {
      baseUrl: 'https://example.com/v1',
      model: 'fixture-model',
      apiKeyEnv: 'TEST_KEY',
      proxyUrl: '',
    };
    const backup = (id: string) => ({
      id,
      createdAt: Date.now(),
      sizeBytes: 4096,
      fileCount: 3,
      automatic: false,
      error: null,
    });
    Object.assign(window, {
      isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: 'main' }, currentWindow: { label: 'main' } },
        transformCallback: (callback: (...args: unknown[]) => void) => {
          const id = ++callbackId;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args?: Record<string, unknown>) => {
          switch (command) {
            case 'plugin:event|listen': {
              const id = ++callbackId;
              eventListeners.set(id, {
                event: String(args?.event),
                handler: Number(args?.handler),
              });
              return id;
            }
            case 'plugin:event|unlisten':
              eventListeners.delete(Number(args?.eventId));
              return null;
            case 'configuration_snapshot':
              return {
                revision: 1,
                settingsRevision: 1,
                settings,
                ui: { font_size: 14, sidebar_width: 246, inspector_width: 294 },
                appearance: {
                  language: localStorage.getItem('fixture-appearance-language') ?? 'zh-CN',
                  theme: 'system',
                },
                appearanceConfigured: true,
                error: null,
                watching: true,
              };
            case 'configuration_runtime_idle':
              return true;
            case 'load_ui_state':
              return {
                version: 1,
                generation: Number(localStorage.getItem('fixture-ui-generation') ?? '1'),
                values: JSON.parse(localStorage.getItem('fixture-ui-values') ?? '{}'),
              };
            case 'save_ui_state': {
              const values = args?.values ?? {};
              localStorage.setItem('fixture-ui-values', JSON.stringify(values));
              const generation = Number(localStorage.getItem('fixture-ui-generation') ?? '1') + 1;
              localStorage.setItem('fixture-ui-generation', String(generation));
              return { version: 1, generation, values };
            }
            case 'commit_restored_ui_state':
              localStorage.setItem('fixture-ui-values', JSON.stringify(args?.values ?? {}));
              localStorage.setItem('fixture-ui-generation', '2');
              return { version: 1, generation: 2, values: args?.values ?? {} };
            case 'restored_ui_state':
              if (localStorage.getItem('fixture-restored-ui-read-fails'))
                throw new Error('Restore state cannot be read');
              return JSON.parse(localStorage.getItem('fixture-restored-ui') ?? 'null');
            case 'finish_ui_restore':
              localStorage.setItem(
                'fixture-confirm-attempts',
                String(Number(localStorage.getItem('fixture-confirm-attempts') ?? '0') + 1),
              );
              if (localStorage.getItem('fixture-confirm-fails'))
                throw new Error('Restore cleanup failed');
              localStorage.removeItem('fixture-restored-ui');
              return null;
            case 'restart_unconfirmed_restore':
              localStorage.setItem('fixture-restart-requested', 'true');
              return null;
            case 'list_backups':
              if (localStorage.getItem('fixture-backup-list-fails'))
                throw new Error('Backup list unavailable');
              return JSON.parse(localStorage.getItem('fixture-backups') ?? '[]');
            case 'backup_detail': {
              if (localStorage.getItem('fixture-detail-fails'))
                throw new Error('Backup manifest cannot be read');
              const files = JSON.parse(
                localStorage.getItem('fixture-backup-files') ??
                  JSON.stringify([
                    { path: 'fluxcode.toml', sizeBytes: 120, sha256: 'a'.repeat(64) },
                    { path: 'engine-home/history.sqlite', sizeBytes: 2048, sha256: 'b'.repeat(64) },
                    { path: 'ui-state.json', sizeBytes: 512, sha256: 'c'.repeat(64) },
                  ]),
              );
              return {
                summary: backup(String(args?.id)),
                files: files.slice(
                  Number(args?.offset),
                  Number(args?.offset) + Number(args?.limit),
                ),
                totalFiles: files.length,
              };
            }
            case 'open_backup_location':
              localStorage.setItem('fixture-backup-location-opened', 'true');
              return null;
            case 'verify_backup':
              if (localStorage.getItem('fixture-verify-fails'))
                throw new Error('Backup checksum mismatch');
              localStorage.setItem('fixture-verified-backup', String(args?.id));
              return backup(String(args?.id));
            case 'create_backup': {
              const progressId = String(args?.progressId ?? '');
              localStorage.setItem('fixture-active-backup', progressId);
              emit('backup-progress', {
                jobId: progressId,
                stage: 'preparing',
                files: 0,
                bytes: 0,
              });
              await new Promise((resolve) => setTimeout(resolve, 30));
              emit('backup-progress', {
                jobId: progressId,
                stage: 'copying',
                files: 2,
                bytes: 2048,
              });
              if (localStorage.getItem('fixture-backup-delay'))
                await new Promise((resolve) => setTimeout(resolve, 350));
              localStorage.removeItem('fixture-active-backup');
              if (localStorage.getItem('fixture-cancelled-backup') === progressId)
                throw new Error('备份已取消');
              if (localStorage.getItem('fixture-backup-fails')) throw new Error('Disk full');
              emit('backup-progress', {
                jobId: progressId,
                stage: 'publishing',
                files: 3,
                bytes: 4096,
              });
              const rows = JSON.parse(localStorage.getItem('fixture-backups') ?? '[]');
              const created = backup('created-backup');
              localStorage.setItem('fixture-backups', JSON.stringify([created, ...rows]));
              return created;
            }
            case 'cancel_backup': {
              const active = localStorage.getItem('fixture-active-backup');
              if (active && active === args?.progressId) {
                localStorage.setItem('fixture-cancelled-backup', active);
                return true;
              }
              return false;
            }
            case 'remove_backup':
              localStorage.setItem(
                'fixture-backups',
                JSON.stringify(
                  JSON.parse(localStorage.getItem('fixture-backups') ?? '[]').filter(
                    (item: { id: string }) => item.id !== args?.id,
                  ),
                ),
              );
              return null;
            case 'request_backup_restore':
              localStorage.setItem('fixture-restore-requested', String(args?.id));
              return backup('safety-backup');
            case 'restart_for_restore':
              localStorage.setItem('fixture-restart-requested', 'true');
              return null;
            default:
              return null;
          }
        },
      },
    });
  });
}

test('conversation body search opens the matching message and batch organization keeps selection', async ({
  page,
}) => {
  await setup(page);
  const composer = page.getByPlaceholder('描述一个任务，或提出关于代码的问题…');
  await composer.fill('创建搜索任务');
  await composer.press('Enter');
  await expect(page.getByText('任务完成，已验证。')).toBeVisible();
  await page.getByRole('button', { name: '搜索对话正文' }).click();
  await page.getByRole('textbox', { name: '搜索词' }).fill('恢复成功');
  await page
    .getByRole('dialog', { name: '搜索对话正文' })
    .getByRole('button', { name: '搜索', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: '搜索对话正文' }).getByText('恢复成功'),
  ).toBeVisible();
  await page.getByRole('dialog', { name: '搜索对话正文' }).getByText('恢复成功').click();
  await expect(page.getByRole('dialog', { name: '搜索对话正文' })).not.toBeVisible();
  await page.getByRole('button', { name: '批量整理' }).click();
  await page.getByRole('button', { name: '全选当前筛选' }).click();
  await expect(page.getByText('已选择 1')).toBeVisible();
  await page.getByRole('button', { name: '批量归档' }).click();
  await expect(page.getByText('已完成 1 · 失败 0')).toBeVisible();
  await page.getByRole('button', { name: '已归档' }).click();
  await page.getByRole('button', { name: '全选当前筛选' }).click();
  await page.getByRole('button', { name: '批量恢复' }).click();
  await expect(page.getByText('已完成 1 · 失败 0')).toBeVisible();
});

test('first use routes model selection to channels and the project chip opens a folder', async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'fixture-settings',
      JSON.stringify({
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        apiKeyEnv: 'OPENAI_API_KEY',
        proxyUrl: '',
      }),
    ),
  );
  await page.reload();
  await page.getByRole('textbox', { name: '任务描述' }).fill('keep my first task');
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.chooseAttachments = async () => ['D:/Fixtures/spec.md'];
  });
  await page.getByRole('button', { name: '添加文件或图片', exact: true }).click();
  await expect(page.locator('.attachment-list')).toContainText('spec.md');
  await page.getByRole('combobox', { name: '当前会话模型' }).click();
  await expect(page.getByRole('dialog', { name: '渠道管理', exact: true })).toBeVisible();
  await expect(page.getByText('添加你的第一个渠道', { exact: true })).toBeVisible();
  await expect(page.getByLabel('模型 ID', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('keep my first task');
  await page.locator('.composer-project').click();
  await expect(page.locator('.composer-project')).toContainText('sample-project');
  await expect(page.locator('.attachment-list')).toContainText('spec.md');
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('keep my first task');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('keep my first task');
});

test('model and effort belong to a conversation, survive reload and failure, and new tasks start Off', async ({
  page,
}) => {
  await setup(page);
  const model = page.getByRole('combobox', { name: '当前会话模型' });
  const effort = page.getByRole('combobox', { name: '推理强度' });
  await expect(effort).toHaveAttribute('data-value', 'off');
  await choose(model, '__custom__');
  await page.getByRole('textbox', { name: '模型 ID', exact: true }).fill('custom-model');
  await page.getByRole('button', { name: '使用模型' }).click();
  await choose(effort, 'high');
  await page.getByRole('textbox', { name: '任务描述' }).fill('task-with-high');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.getByRole('button', { name: '新建任务 Ctrl N', exact: true }).click();
  await expect(model).toHaveAttribute('data-value', 'custom-model');
  await expect(effort).toHaveAttribute('data-value', 'off');
  await page.getByRole('button', { name: 'task-with-high', exact: true }).click();
  await expect(effort).toHaveAttribute('data-value', 'high');
  await choose(effort, 'none');
  await page.reload();
  await page.getByRole('button', { name: 'task-with-high', exact: true }).click();
  await expect(model).toHaveAttribute('data-value', 'custom-model');
  await expect(effort).toHaveAttribute('data-value', 'none');
  await expect(effort).toBeEnabled();
  await choose(effort, 'off');
  await page.getByRole('textbox', { name: '任务描述' }).fill('trigger-failure');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.error-banner')).toContainText('操作未完成');
  await expect(effort).toHaveAttribute('data-value', 'off');
  const sent = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-last-turn')!));
  expect(sent.model).toBe('custom-model');
  expect(sent.collaborationMode.settings.reasoning_effort).toBeNull();
  expect(sent).not.toHaveProperty('effort');
});

test('running selections are locked and typography persists at narrow widths', async ({ page }) => {
  await setup(page);
  await choose(page.getByRole('combobox', { name: '推理强度' }), 'medium');
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.getByRole('combobox', { name: '推理强度' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '当前会话模型' })).toBeDisabled();
  await page.getByRole('button', { name: '停止任务' }).click();
  await expect(page.getByRole('combobox', { name: '推理强度' })).toBeEnabled();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await choose(page.getByRole('combobox', { name: '界面字号' }), '18');
  await expect(page.getByRole('combobox', { name: '界面字号' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.setViewportSize({ width: 960, height: 680 });
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveCSS('font-size', '19px');
  const bounds = await page
    .locator('.composer')
    .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  await expect(page.getByRole('combobox', { name: '推理强度' })).toBeInViewport();
});

test('workspace layout, files, diff, settings and terminal form a working flow', async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole('heading', { name: '让想法，在代码中发生。' })).toBeVisible();
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(page.getByText('UTF-8 中文预览')).toBeVisible();
  await page.getByRole('button', { name: '变更1', exact: true }).click();
  await page.getByRole('button', { name: '修改 src/main.ts', exact: true }).click();
  await expect(page.locator('.diff-code-insert')).toContainText('new');
  await expect(page.locator('.diff-code-delete')).toContainText('old');
  await page.getByRole('button', { name: '并排对比', exact: true }).click();
  await expect(page.locator('.diff')).toHaveClass(/diff-split/);
  await page.getByRole('button', { name: '切换终端' }).click();
  await page.getByRole('button', { name: '命令', exact: true }).click();
  await page.getByRole('textbox', { name: '终端命令' }).fill('echo terminal-ok');
  await page.getByRole('button', { name: '执行命令' }).click();
  await expect(page.locator('.terminal-output')).toContainText('[退出码 0]');
  await page.screenshot({ animations: 'disabled', path: 'test-results/workspace.png' });
});

test('real task UI streams, persists metadata and resumes after reload', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('分析项目');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成，已验证。');
  await expect(page.locator('.user-message')).toContainText('分析项目');
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '分析项目', exact: true }).click();
  await expect(page.locator('.assistant-message')).toContainText('恢复成功');
});

test('stop interrupts active work and failures retain the draft', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  await page.getByRole('button', { name: '停止任务' }).click();
  await expect(page.getByRole('button', { name: '停止任务' })).not.toBeVisible();
  await page.getByRole('textbox', { name: '任务描述' }).fill('trigger-failure');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.error-banner')).toContainText('操作未完成');
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('trigger-failure');
});

test('keyboard focus is visible and task progress is announced', async ({ page }) => {
  const search = page.getByRole('textbox', { name: '搜索任务' });
  await search.focus();
  expect(
    await search.evaluate(
      (input) => getComputedStyle(input.closest('.search-field')!).outlineStyle,
    ),
  ).toBe('solid');

  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.working-indicator')).toHaveAttribute('role', 'status');
  await expect(page.locator('.working-indicator')).toContainText('FluxCode 正在处理');
  await page.getByRole('button', { name: '停止任务' }).click();
  await expect(page.locator('.working-indicator')).toHaveCount(0);
  await page.getByRole('textbox', { name: '任务描述' }).fill('trigger-failure');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.error-banner')).toHaveAttribute('role', 'alert');
});

test('command palette restores focus to its trigger on Escape', async ({ page }) => {
  const trigger = page.getByRole('button', { name: '命令面板', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '搜索命令或任务' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '命令面板' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('primary dialogs return keyboard focus to their launch controls', async ({ page }) => {
  await setup(page);
  for (const [button, dialogName] of [
    ['渠道管理', '渠道管理'],
    ['搜索对话正文', '搜索对话正文'],
    ['导入对话', '导入对话'],
    ['定时任务', '定时任务'],
    ['模型与扩展', '模型与扩展'],
  ]) {
    const trigger = page.getByRole('button', { name: button, exact: true });
    await trigger.focus();
    await trigger.press('Enter');
    await expect(page.getByRole('dialog', { name: dialogName, exact: true })).toBeVisible();
    if (button === '搜索对话正文')
      await expect(page.getByRole('textbox', { name: '搜索词' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: dialogName, exact: true })).not.toBeVisible();
    await expect.soft(trigger, button).toBeFocused();
  }
});

test('sidebar search keeps a predictable keyboard path', async ({ page }) => {
  const search = page.getByRole('textbox', { name: '搜索任务' });
  await search.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '搜索对话正文', exact: true })).toBeFocused();
});

test('nested channel navigation returns to the channel control', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '管理渠道', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '渠道管理' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '切换渠道' })).toBeFocused();
});

test('task actions return focus to their task row', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('focus task');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  const trigger = page.getByRole('button', { name: '整理任务 focus task', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('dialog', { name: '整理任务' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('settings and model selection return focus to their launch controls', async ({ page }) => {
  const settings = page.getByRole('button', { name: '设置', exact: true });
  await settings.focus();
  await settings.press('Enter');
  await expect(page.getByRole('dialog', { name: '工作空间设置' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();

  await setup(page);
  const model = page.getByRole('combobox', { name: '当前会话模型' });
  await model.focus();
  await model.press('Enter');
  await expect(page.getByRole('dialog', { name: '选择模型' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(model).toBeFocused();
});

test('primary views expose names for every visible button', async ({ page }) => {
  async function expectNamedControls() {
    for (const role of ['button', 'textbox', 'combobox', 'checkbox', 'slider'] as const)
      await expect(page.getByRole(role, { name: '', exact: true }), role).toHaveCount(0);
  }
  await expectNamedControls();
  await setup(page);
  for (const name of ['工作空间设置', '渠道管理', '搜索对话正文', '导入对话']) {
    const trigger = page.getByRole('button', {
      name: name === '工作空间设置' ? '设置' : name,
      exact: true,
    });
    await trigger.click();
    await expect(page.getByRole('dialog', { name })).toBeVisible();
    await expectNamedControls();
    await page.keyboard.press('Escape');
  }
});

test('search empty states clear the query and return focus', async ({ page }) => {
  await setup(page);
  const sidebarQuery = page.getByRole('textbox', { name: '搜索任务' });
  await sidebarQuery.fill('no matching task');
  await expect(page.getByText('没有匹配的任务')).toBeVisible();
  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(sidebarQuery).toHaveValue('');
  await expect(sidebarQuery).toBeFocused();

  await page.getByRole('button', { name: '搜索对话正文', exact: true }).click();
  const conversationQuery = page.getByRole('textbox', { name: '搜索词' });
  await conversationQuery.fill('no matching message');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('没有匹配的消息')).toBeVisible();
  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(conversationQuery).toHaveValue('');
  await expect(conversationQuery).toBeFocused();
});

test('canceling conversation search gives feedback and allows an immediate retry', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('searchable task');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.evaluate(() => {
    const original = window.__FLUX_TEST_BRIDGE__!.rpc;
    localStorage.setItem('fixture-block-search', 'true');
    window.__FLUX_TEST_BRIDGE__!.rpc = async <T>(method: string, params: object): Promise<T> => {
      if (method === 'thread/read' && localStorage.getItem('fixture-block-search'))
        return new Promise<T>(() => {});
      return original<T>(method, params);
    };
  });
  await page.getByRole('button', { name: '搜索对话正文', exact: true }).click();
  const query = page.getByRole('textbox', { name: '搜索词' });
  await query.fill('searchable');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: '取消搜索' }).click();
  await expect(page.getByText('搜索已取消')).toBeVisible();
  await expect(query).toHaveValue('searchable');
  await page.evaluate(() => localStorage.removeItem('fixture-block-search'));
  await query.fill('missing result');
  await expect(page.getByText('搜索已取消')).toHaveCount(0);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('没有匹配的消息')).toBeVisible();
});

test('workspace search preserves input after failure and clears an empty result', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    let calls = 0;
    window.__FLUX_TEST_BRIDGE__!.searchWorkspace = async () => {
      if (++calls === 1) throw new Error('search temporarily unavailable');
      return { hits: [], truncated: false };
    };
  });
  await page.getByText('搜索工作区', { exact: true }).click();
  const query = page.getByRole('textbox', { name: '搜索内容' });
  await query.fill('important code');
  await page
    .locator('.workspace-search')
    .getByRole('button', { name: '搜索', exact: true })
    .click();
  const error = page.locator('.workspace-search [role="alert"]');
  await expect(error).toContainText('操作未完成');
  await expect(error).toBeFocused();
  await expect(query).toHaveValue('important code');
  await page
    .locator('.workspace-search')
    .getByRole('button', { name: '搜索', exact: true })
    .click();
  await expect(page.locator('.workspace-search').getByText('没有匹配结果')).toBeVisible();
  await page.locator('.workspace-search').getByRole('button', { name: '清除搜索' }).click();
  await expect(query).toHaveValue('');
  await expect(query).toBeFocused();
});

test('channel import failure keeps the entered address and focuses its error', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.discoverProvider = async () => {
      throw new Error('service temporarily unavailable');
    };
  });
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  const address = page.getByLabel('服务地址', { exact: true });
  await address.fill('https://retry.example/v1');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  const error = page.locator('.channel-editor [role="alert"]');
  await expect(error).toContainText('操作未完成');
  await expect(error).toBeFocused();
  await expect(address).toHaveValue('https://retry.example/v1');
});

test('failed replacement import keeps the last valid preview', async ({ page }) => {
  await page.evaluate(() => {
    let reads = 0;
    window.__FLUX_TEST_BRIDGE__!.readDocument = async () =>
      ++reads === 1
        ? JSON.stringify({
            schemaVersion: 1,
            entries: [
              {
                project: { name: 'Valid project', path: 'D:/valid' },
                task: { id: 'valid-task', title: 'Valid preview', updatedAt: 42 },
                messages: [{ id: 'valid-message', kind: 'assistant', text: 'Keep this preview' }],
              },
            ],
          })
        : '{invalid json';
  });
  await page.getByRole('button', { name: '导入对话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入对话' });
  await dialog.getByRole('button', { name: '选择 JSON 文件' }).click();
  await expect(dialog).toContainText('Valid preview');
  await dialog.getByRole('button', { name: '选择 JSON 文件' }).click();
  await expect(dialog).toContainText('Valid preview');
  await expect(dialog.locator('[role="alert"]')).toBeFocused();
  await expect(dialog.getByRole('button', { name: '导入对话', exact: true })).toBeEnabled();
});

test('failed task export keeps task edits and focuses the error', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('export focus');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.exportDocument = async () => {
      throw new Error('export temporarily unavailable');
    };
  });
  await page.getByRole('button', { name: '整理任务 export focus', exact: true }).click();
  const title = page.getByRole('textbox', { name: '任务名称' });
  await title.fill('Edited before export');
  await page.getByRole('button', { name: '导出文档' }).click();
  const dialog = page.getByRole('dialog', { name: '整理任务' });
  await expect(dialog.locator('[role="alert"]')).toBeFocused();
  await expect(title).toHaveValue('Edited before export');
});

test('window and panel controls do not stop an active task', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' } },
        invoke: async (command: string) => {
          const commands = JSON.parse(localStorage.getItem('fixture-window-commands') ?? '[]');
          commands.push(command);
          localStorage.setItem('fixture-window-commands', JSON.stringify(commands));
          return null;
        },
      },
    });
  });
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  const stop = page.getByRole('button', { name: '停止任务', exact: true });
  await expect(stop).toBeVisible();

  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await page.getByRole('button', { name: '关闭终端', exact: true }).click();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(stop).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-window-commands') ?? '[]')),
  ).toEqual(['plugin:window|minimize', 'plugin:window|close']);

  await stop.click();
  await expect(stop).not.toBeVisible();
});

test('empty workspace and narrow desktop layout have no horizontal overflow', async ({ page }) => {
  await page.screenshot({ animations: 'disabled', path: 'test-results/welcome.png' });
  await page.setViewportSize({ width: 960, height: 680 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(960);
  await page.getByRole('button', { name: '设置' }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/settings.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('appearance follows system, remembers overrides, and translates the working UI', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await choose(page.getByRole('combobox', { name: '语言', exact: true }), 'en');
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible();
  await choose(page.getByRole('combobox', { name: 'Theme', exact: true }), 'dark');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Where ideas become code.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Task description' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/english-dark.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await choose(page.getByRole('combobox', { name: 'Theme', exact: true }), 'system');
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ animations: 'disabled', path: 'test-results/english-light.png' });
});

test('native picker language follows an appearance switch on the next click', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await choose(page.getByRole('combobox', { name: '语言', exact: true }), 'en');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-picker-language')))
    .toBe('en');
});

test('reopening restores unfinished work and panel visibility', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('未发送的工作');
  await choose(page.getByRole('combobox', { name: '推理强度' }), 'high');
  await page.getByRole('button', { name: '切换文件面板', exact: true }).click();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('未发送的工作');
  await expect(page.getByRole('combobox', { name: '推理强度' })).toHaveAttribute(
    'data-value',
    'high',
  );
  await expect(page.locator('.inspector')).toHaveCount(0);
});

test('context budgets persist, clear to defaults, and validate thresholds', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('spinbutton', { name: '上下文窗口上限' }).fill('200000');
  await page.getByRole('spinbutton', { name: '自动压缩阈值' }).fill('200000');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('alert')).toContainText('自动压缩阈值必须小于上下文窗口');
  await page.getByRole('spinbutton', { name: '自动压缩阈值' }).fill('160000');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '上下文窗口上限' })).toHaveValue('200000');
  await expect(page.getByRole('spinbutton', { name: '自动压缩阈值' })).toHaveValue('160000');
  await page.getByRole('spinbutton', { name: '上下文窗口上限' }).fill('');
  await page.getByRole('spinbutton', { name: '自动压缩阈值' }).fill('');
  await page.getByRole('button', { name: '保存设置' }).click();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-settings')!));
  expect(settings.contextWindow).toBeNull();
  expect(settings.autoCompactTokens).toBeNull();
});

test('manual compaction retains history, locks controls, reports context and recovers from rejection', async ({
  page,
}) => {
  await setup(page);
  await page.locator('.usage-indicator summary').click();
  await expect(page.getByRole('button', { name: '压缩上下文', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '任务描述' }).fill('Keep this task');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.getByRole('textbox', { name: '任务描述' }).fill('Unsent draft');
  await page.getByRole('button', { name: '压缩上下文', exact: true }).click();
  await expect(page.getByText('正在压缩上下文…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '压缩上下文', exact: true })).toBeDisabled();
  await expect(page.getByText('上下文已压缩', { exact: true })).toBeVisible();
  await expect(page.locator('.usage-indicator summary')).toContainText('30%');
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('Unsent draft');
  await page.evaluate(() => localStorage.setItem('fixture-compact-fail', 'true'));
  await page.getByRole('button', { name: '压缩上下文', exact: true }).click();
  await expect(page.locator('.error-banner')).toContainText('操作未完成');
  await expect(page.getByRole('button', { name: '压缩上下文', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('Unsent draft');
});

test('Chinese is the default even with an English system language; context settings translate fully', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US'] }),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await choose(page.getByRole('combobox', { name: '语言', exact: true }), 'en');
  await expect(page.getByRole('spinbutton', { name: 'Context window limit' })).toBeVisible();
  expect(await page.locator('.context-settings').innerText()).not.toMatch(/[\u3400-\u9fff]/);
  expect(await page.locator('.appearance-settings').innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await choose(page.getByRole('combobox', { name: 'Theme', exact: true }), 'light');
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/context-settings-light.png',
  });
});

test('stopping pauses queued work until an explicit resume', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('queued-work');
  await page.getByRole('button', { name: '排队发送', exact: true }).click();
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(page.locator('.queued-messages')).toContainText('已暂停');
  await expect(page.locator('.queued-messages')).toContainText('queued-work');
  await page.getByRole('button', { name: '继续发送', exact: true }).click();
  await expect(page.locator('.queued-messages')).toHaveCount(0);
  await expect(page.locator('.user-message')).toContainText('queued-work');
});

test('a queued action survives reload without automatic replay', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('after-restart');
  await page.getByRole('button', { name: '排队发送', exact: true }).click();
  await expect(page.locator('.queued-messages')).toContainText('after-restart');
  await page.reload();
  await expect(page.locator('.queued-messages')).toContainText('after-restart');
  await expect(page.locator('.queued-messages')).toContainText('应用已重启');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('fixture-last-turn') ?? '{}').input?.[0]?.text,
    ),
  ).toBe('long-running');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.queued-messages')).toHaveCount(0);
  await expect(page.locator('.user-message').last()).toContainText('after-restart');
});

test('a queued send failure remains visible and does not consume the message', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('trigger-failure');
  await page.getByRole('button', { name: '排队发送', exact: true }).click();
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await page.getByRole('button', { name: '继续发送', exact: true }).click();
  await expect(page.locator('.queued-messages')).toContainText('trigger-failure');
  await expect(page.locator('.queued-messages')).toContainText('发送失败');
  await page.reload();
  await expect(page.locator('.queued-messages')).toContainText('trigger-failure');
  await expect(page.locator('.queued-messages')).toContainText('重试');
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await expect(page.getByText('确认移除此待发送消息？')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.queued-messages')).toContainText('trigger-failure');
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.queued-messages')).toHaveCount(0);
});

test('a queued turn accepted by the engine remains until stream completion', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.getByRole('textbox', { name: '任务描述' }).fill('stream-failure');
  await page.getByRole('button', { name: '排队发送', exact: true }).click();
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await page.getByRole('button', { name: '继续发送', exact: true }).click();
  await expect(page.locator('.queued-messages')).toContainText('发送中');
  await expect(page.locator('.queued-messages')).toContainText('发送失败');
  await expect(page.locator('.queued-messages')).toContainText('stream-failure');
});

test('invalid persisted queue is reported without overwriting its original bytes', async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem('fluxcode.queue.v1', '{broken queue'));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('待发送队列数据损坏');
  expect(await page.evaluate(() => localStorage.getItem('fluxcode.queue.v1'))).toBe(
    '{broken queue',
  );
});

test('one click imports every model and switching channels preserves both catalogues', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://primary.example/v1');
  await page.getByLabel('访问密钥', { exact: true }).fill('fixture-only-not-a-secret');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('combobox', { name: '当前会话模型' }).click();
  await expect(page.getByRole('option', { name: 'fixture-model', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'other-model', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await expect(page.locator('.channel-card')).toContainText('primary.example');
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://backup.example/v1');
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(2);
  await page
    .locator('.channel-card')
    .filter({ hasText: 'backup.example' })
    .getByRole('button', { name: '启用', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '切换渠道', exact: true })).toHaveText(
    'backup.example',
  );
  await page.reload();
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(2);
  await page
    .locator('.channel-card')
    .filter({ hasText: 'primary.example' })
    .getByRole('button', { name: '启用', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '切换渠道', exact: true })).toHaveText(
    'primary.example',
  );
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-profiles')!));
  expect(profiles.map((p: { models: string[] }) => p.models)).toEqual([
    ['fixture-model', 'other-model'],
    ['fixture-model', 'other-model'],
  ]);
  expect(profiles[0].settings.apiKeyEnv).not.toBe(profiles[1].settings.apiKeyEnv);
  expect(JSON.stringify(profiles)).not.toContain('fixture-only-not-a-secret');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('用量费用估算', { exact: true }).click();
  await page.getByLabel('使用自定义价格').check();
  await page.getByLabel('输入单价', { exact: true }).fill('2');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-settings')!).pricing.input),
  ).toBe(2);
});

test('import preview isolates credentials for duplicate provider identities and exports a selection', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://same.example/v1');
  await page.getByLabel('访问密钥', { exact: true }).fill('first-key');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const firstProfile = await page.evaluate(
    () => JSON.parse(localStorage.getItem('fixture-profiles')!)[0],
  );
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '批量导入渠道', exact: true }).click();
  await page.getByLabel('渠道 TOML', { exact: true }).fill(
    JSON.stringify({
      schema_version: 1,
      profiles: [
        {
          name: 'Imported',
          settings: { ...firstProfile.settings, baseUrl: 'https://same.example/v1' },
          models: ['fixture-model'],
        },
      ],
    }),
  );
  await page.getByRole('button', { name: '预览导入', exact: true }).click();
  await expect(
    page.getByText('相同地址与凭据标识已分离，导入后需为这些渠道设置密钥。', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-profiles')!));
  expect(profiles).toHaveLength(2);
  expect(profiles[1].settings.apiKeyEnv).not.toBe(profiles[0].settings.apiKeyEnv);
  await page.getByRole('button', { name: '导出所选渠道', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Imported' }).check();
  await page.getByRole('button', { name: /导出所选渠道 · 1/ }).click();
  const exported = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-export')!));
  expect(exported.name).toBe('FluxCode-channels.toml');
  expect(
    JSON.parse(exported.content).profiles.map((profile: { name: string }) => profile.name),
  ).toEqual(['Imported']);
  expect(exported.content).not.toContain('first-key');
});

test('copy keeps the model catalogue and requires an independent key', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://copy.example/v1');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '复制渠道配置', exact: true }).click();
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  await expect(page.getByText('副本需要单独设置密钥。')).toBeVisible();
  await page.getByLabel('访问密钥', { exact: true }).fill('new-key');
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-profiles')!));
  expect(profiles).toHaveLength(2);
  expect(profiles[1].models).toEqual(['fixture-model', 'other-model']);
  expect(profiles[1].settings.apiKeyEnv).not.toBe(profiles[0].settings.apiKeyEnv);
});

test('import conflict choices preview skip and replace before the atomic save', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://original.example/v1');
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  const original = await page.evaluate(
    () => JSON.parse(localStorage.getItem('fixture-profiles')!)[0],
  );
  await page.getByRole('button', { name: '批量导入渠道', exact: true }).click();
  await page.getByLabel('渠道 TOML', { exact: true }).fill(
    JSON.stringify({
      schema_version: 1,
      profiles: [
        {
          ...original,
          settings: { ...original.settings, baseUrl: 'https://replacement.example/v1' },
          models: ['replacement-model'],
        },
      ],
    }),
  );
  await page.getByRole('button', { name: '预览导入', exact: true }).click();
  await page.getByRole('radio', { name: '跳过同名渠道' }).check();
  await expect(page.getByText('跳过渠道 · 1')).toBeVisible();
  await expect(page.getByRole('button', { name: '导入全部渠道', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: '替换同名渠道' }).check();
  await expect(
    page.getByText('将替换同名渠道配置；原配置无法从此操作恢复。', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-profiles')!));
  expect(saved).toHaveLength(1);
  expect(saved[0].settings.baseUrl).toBe('https://replacement.example/v1');
  expect(saved[0].models).toEqual(['replacement-model']);
});

test('failed channel import keeps the preview and leaves saved profiles unchanged', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const bridge = window.__FLUX_TEST_BRIDGE__!;
    const save = bridge.saveProviderProfiles;
    let attempts = 0;
    bridge.saveProviderProfiles = async (profiles, expected) => {
      if (++attempts === 1) throw new Error('渠道列表已在其他位置更新，请重新载入渠道后保存');
      return save(profiles, expected);
    };
  });
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '批量导入渠道', exact: true }).click();
  await page.getByLabel('渠道 TOML', { exact: true }).fill(
    JSON.stringify({
      schema_version: 1,
      profiles: [
        {
          name: 'Recoverable',
          settings: {
            baseUrl: 'https://recover.example/v1',
            model: 'fixture-model',
            apiKeyEnv: 'RECOVERY_KEY',
            proxyUrl: '',
          },
          models: ['fixture-model'],
        },
      ],
    }),
  );
  await page.getByRole('button', { name: '预览导入', exact: true }).click();
  await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
  await expect(page.getByText('渠道列表已在其他位置更新，请重新载入渠道后保存')).toBeVisible();
  await expect(page.getByText('Recoverable · 1 个模型')).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-profiles') ?? '[]')),
  ).toEqual([]);
  await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(1);
});

test('model refresh protects the currently running model and previews the complete difference', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://refresh.example/v1');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.discoverProvider = async () => ({
      models: ['replacement-model'],
      latencyMs: 8,
    });
  });
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '刷新模型', exact: true }).click();
  await expect(
    page.getByText('当前会话使用的模型已移除，请先切换到其他渠道，再应用此目录。'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '应用模型变更', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.discoverProvider = async () => ({
      models: ['fixture-model', 'replacement-model'],
      latencyMs: 8,
    });
  });
  await page.getByRole('button', { name: '刷新模型', exact: true }).click();
  await expect(page.getByText('保留模型 1', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '应用模型变更', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '应用模型变更', exact: true }).click();
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-profiles')!));
  expect(profiles[0].models).toEqual(['fixture-model', 'replacement-model']);
});

test('channel catalogue is informational, searchable, and keeps the full list after filtering', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://models.example/v1');
  await page.getByText('模型与连接选项（可选）', { exact: true }).click();
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await page.getByLabel('搜索模型', { exact: true }).fill('other');
  await expect(page.getByRole('list', { name: '服务模型' })).toContainText('other-model');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-profiles')!));
  expect(profiles[0].models).toEqual(['fixture-model', 'other-model']);
});

test('failed import retains the URL and credential and supports retry without extra steps', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    let count = 0;
    window.__FLUX_TEST_BRIDGE__!.discoverProvider = async () => {
      if (++count === 1) throw new Error('network');
      return { models: ['recovered-model'], latencyMs: 1 };
    };
  });
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://retry.example/v1');
  await page.getByLabel('访问密钥', { exact: true }).fill('fixture-key');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('访问密钥', { exact: true })).toHaveValue('fixture-key');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '当前会话模型' })).toHaveAttribute(
    'data-value',
    'recovered-model',
  );
});

test('schedule lifecycle is explicit and remembered', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill('Routine review');
  await page.getByLabel('任务指令', { exact: true }).fill('Review current changes');
  await page.getByLabel('间隔分钟', { exact: true }).fill('60');
  await page.getByRole('button', { name: '创建定时任务', exact: true }).click();
  await expect(page.getByRole('dialog').locator('article')).toContainText('Routine review');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await expect(page.getByText('确认移除此定时任务？')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog').locator('article')).toContainText('Routine review');
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('dialog').locator('article')).toHaveCount(0);
});

test('scheduled task submission is idempotent while pending and clears only after success', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const original = window.__FLUX_TEST_BRIDGE__!.saveSchedule;
    window.__FLUX_TEST_BRIDGE__!.saveSchedule = async (job) => {
      const calls = Number(localStorage.getItem('fixture-schedule-calls') ?? 0) + 1;
      localStorage.setItem('fixture-schedule-calls', String(calls));
      await new Promise((resolve) => setTimeout(resolve, 100));
      return original(job);
    };
  });
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  const name = page.getByLabel('任务名称', { exact: true });
  await name.fill('One scheduled job');
  await page.getByLabel('任务指令', { exact: true }).fill('Run once');
  await page.getByLabel('间隔分钟', { exact: true }).fill('30');
  await page.locator('dialog[open] form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByText('定时任务已创建')).toBeVisible();
  await expect(name).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('fixture-schedule-calls'))).toBe('1');
  await expect(page.getByRole('dialog').locator('article')).toHaveCount(1);
});

test('Enter imports a channel and includes manually entered models without another add click', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://manual.example/v1');
  await page.getByText('模型与连接选项（可选）', { exact: true }).click();
  await page.getByText('手动添加模型', { exact: true }).click();
  const input = page.getByLabel('模型 ID', { exact: true });
  await input.fill('custom-a, custom-b custom-a');
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-profiles')!)[0].models),
  ).toEqual(['custom-a', 'custom-b']);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索渠道' }).fill('not-present');
  await expect(page.getByText('没有匹配的渠道', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(1);
});

test('a large channel list stays searchable and long details fit narrow windows', async ({
  page,
}) => {
  await page.evaluate(() => {
    const profiles = Array.from({ length: 180 }, (_, index) => ({
      name:
        index === 73
          ? `LongChannel${'UnbrokenName'.repeat(12)}`
          : `Channel ${String(index + 1).padStart(3, '0')}`,
      settings: {
        baseUrl:
          index === 73
            ? `https://long-provider.example/${'nested-segment/'.repeat(20)}v1`
            : `https://provider-${index + 1}.example/v1`,
        model: `model-${index + 1}`,
        apiKeyEnv: `CHANNEL_KEY_${index + 1}`,
        proxyUrl: '',
      },
      models: [`model-${index + 1}`],
    }));
    localStorage.setItem('fixture-profiles', JSON.stringify(profiles));
  });
  await page.reload();
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(180);
  const search = page.getByRole('textbox', { name: '搜索渠道' });
  await search.fill('long-provider.example');
  await expect(page.locator('.channel-card')).toHaveCount(1);
  await expect(page.locator('.channel-card')).toContainText('LongChannel');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const dimensions = await page.locator('.channels-dialog').evaluate((dialog) => ({
      dialog: [dialog.clientWidth, dialog.scrollWidth],
      card: [
        dialog.querySelector('.channel-card')!.clientWidth,
        dialog.querySelector('.channel-card')!.scrollWidth,
      ],
    }));
    expect(dimensions.dialog[1]).toBeLessThanOrEqual(dimensions.dialog[0] + 1);
    expect(dimensions.card[1]).toBeLessThanOrEqual(dimensions.card[0] + 1);
  }
  await search.fill('no channel matches this');
  await expect(page.getByText('没有匹配的渠道', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.channel-card')).toHaveCount(180);
});

test('restored data stays behind a confirmation gate until startup and cleanup succeed', async ({
  page,
}) => {
  await installNativeBackupFixture(page);
  await page.evaluate(() => {
    localStorage.setItem('fixture-restored-ui', '{}');
    localStorage.setItem('fixture-confirm-fails', 'true');
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '恢复尚未确认' })).toBeVisible();
  await expect(page.locator('.restore-content')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('button', { name: '重试确认' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fixture-restored-ui'))).toBe('{}');
  await page.evaluate(() => localStorage.removeItem('fixture-confirm-fails'));
  await page.getByRole('button', { name: '重试确认' }).click();
  await expect(page.locator('.restore-content')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('button', { name: '渠道管理', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fixture-confirm-attempts'))).toBe('2');
  expect(await page.evaluate(() => localStorage.getItem('fixture-restored-ui'))).toBeNull();
});

test('a damaged restored workspace cannot confirm and offers an English restart path', async ({
  page,
}) => {
  await installNativeBackupFixture(page);
  await page.evaluate(() => {
    localStorage.setItem('fixture-restored-ui', JSON.stringify({ 'fluxcode.catalog.v1': '{' }));
    localStorage.setItem('fixture-appearance-language', 'en');
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The restore is not confirmed' })).toBeVisible();
  await expect(page.locator('.restore-content')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('button', { name: 'Restart FluxCode' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fixture-confirm-attempts'))).toBeNull();
  await page.getByRole('button', { name: 'Restart FluxCode' }).click();
  expect(await page.evaluate(() => localStorage.getItem('fixture-restart-requested'))).toBe('true');
});

test('a failed restore-state read offers restart before the application mounts', async ({
  page,
}) => {
  await installNativeBackupFixture(page);
  await page.evaluate(() => {
    localStorage.setItem('fixture-restored-ui-read-fails', 'true');
    localStorage.setItem(
      'fluxcode.appearance.v1',
      JSON.stringify({ language: 'en', theme: 'light' }),
    );
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The workspace could not open' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restart FluxCode' })).toBeVisible();
  await page.getByRole('button', { name: 'Restart FluxCode' }).click();
  expect(await page.evaluate(() => localStorage.getItem('fixture-restart-requested'))).toBe('true');
});

test('local backup controls list, verify, create, open, and remove snapshots', async ({ page }) => {
  await installNativeBackupFixture(page);
  await page.evaluate(() => {
    localStorage.setItem(
      'fixture-backups',
      JSON.stringify([
        {
          id: 'existing-backup',
          createdAt: Date.now(),
          sizeBytes: 4096,
          fileCount: 3,
          automatic: false,
          error: null,
        },
      ]),
    );
  });
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const backups = page.locator('.backup-settings');
  await expect(backups.locator('.backup-row')).toHaveCount(1);
  await backups.getByRole('button', { name: '详情' }).click();
  await expect(backups.getByText('尚未校验')).toBeVisible();
  await expect(backups.getByText('文件清单 · 3')).toBeVisible();
  await expect(backups.locator('.backup-files li')).toHaveCount(3);
  await backups.getByRole('button', { name: '校验' }).click();
  await expect(backups.getByText('备份校验通过。')).toBeVisible();
  await expect(backups.getByText('校验通过', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fixture-verified-backup'))).toBe(
    'existing-backup',
  );
  await backups.getByRole('button', { name: '打开备份位置' }).click();
  expect(await page.evaluate(() => localStorage.getItem('fixture-backup-location-opened'))).toBe(
    'true',
  );
  await page.evaluate(() => localStorage.setItem('fixture-backup-delay', 'true'));
  await backups.getByRole('button', { name: '立即备份' }).click();
  await expect(backups.getByText('正在复制并校验…')).toBeVisible();
  await expect(backups.getByText('2 个文件 · 2 KiB')).toBeVisible();
  await expect(backups.getByRole('button', { name: '取消备份' })).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭设置' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '工作空间设置' })).toBeVisible();
  await expect(backups.locator('.backup-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '关闭设置' })).toBeEnabled();
  await page.evaluate(() => localStorage.removeItem('fixture-backup-delay'));
  await backups.locator('.backup-row').first().getByRole('button', { name: '删除' }).click();
  await backups.getByRole('button', { name: '确认删除' }).click();
  await expect(backups.locator('.backup-row')).toHaveCount(1);
  expect(
    (await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-backups')!))).map(
      (item: { id: string }) => item.id,
    ),
  ).toEqual(['existing-backup']);
  await backups.getByRole('button', { name: '恢复' }).click();
  await backups.getByRole('button', { name: '确认恢复并重启' }).click();
  expect(await page.evaluate(() => localStorage.getItem('fixture-restore-requested'))).toBe(
    'existing-backup',
  );
  expect(await page.evaluate(() => localStorage.getItem('fixture-restart-requested'))).toBe('true');
});

test('backup details page through large manifests and report read and verification failures', async ({
  page,
}) => {
  await installNativeBackupFixture(page);
  await page.evaluate(() => {
    localStorage.setItem(
      'fixture-backups',
      JSON.stringify([
        {
          id: 'large-backup',
          createdAt: Date.now(),
          sizeBytes: 4096,
          fileCount: 55,
          automatic: true,
          error: null,
        },
      ]),
    );
    localStorage.setItem(
      'fixture-backup-files',
      JSON.stringify(
        Array.from({ length: 55 }, (_, index) => ({
          path: `history/file-${index}.json`,
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
        })),
      ),
    );
    localStorage.setItem('fixture-detail-fails', 'true');
    localStorage.setItem('fixture-verify-fails', 'true');
  });
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const backups = page.locator('.backup-settings');
  await backups.getByRole('button', { name: '详情' }).click();
  await expect(backups.getByText('无法读取备份详情，请重试。')).toBeVisible();
  await backups.getByRole('button', { name: '校验' }).click();
  await expect(backups.getByText('校验失败', { exact: true })).toBeVisible();
  await expect(backups.getByText('备份校验失败，请选择其他备份并检查数据目录。')).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('fixture-detail-fails'));
  await backups.getByRole('button', { name: '重试读取备份详情' }).click();
  await expect(backups.locator('.backup-files li')).toHaveCount(50);
  await backups.getByRole('button', { name: '加载更多文件' }).click();
  await expect(backups.locator('.backup-files li')).toHaveCount(55);
  await expect(backups.getByRole('button', { name: '加载更多文件' })).toHaveCount(0);
});

test('failed and canceled manual backups never publish a snapshot, and list errors can be retried', async ({
  page,
}) => {
  await installNativeBackupFixture(page);
  await page.evaluate(() => localStorage.setItem('fixture-backup-list-fails', 'true'));
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const backups = page.locator('.backup-settings');
  await expect(backups.getByText('无法读取备份列表，请重试。')).toBeVisible();
  await expect(backups.getByText('尚无备份。')).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('fixture-backup-list-fails'));
  await backups.getByRole('button', { name: '重试读取备份列表' }).click();
  await expect(backups.getByText('尚无备份。')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('fixture-backup-fails', 'true'));
  await backups.getByRole('button', { name: '立即备份' }).click();
  await expect(backups.getByText('磁盘空间不足，请释放空间后重试备份。')).toBeVisible();
  await expect(backups.locator('.backup-row')).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.removeItem('fixture-backup-fails');
    localStorage.setItem('fixture-backup-delay', 'true');
  });
  await backups.getByRole('button', { name: '立即备份' }).click();
  await expect(backups.getByRole('button', { name: '取消备份' })).toBeVisible();
  await backups.getByRole('button', { name: '取消备份' }).click();
  await expect(backups.getByText('备份已取消，未创建新备份。')).toBeVisible();
  await expect(backups.locator('.backup-row')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('fixture-backups'))).toBeNull();
  await page.evaluate(() => {
    localStorage.removeItem('fixture-backup-delay');
    localStorage.setItem('fixture-backup-list-fails', 'true');
  });
  await backups.getByRole('button', { name: '立即备份' }).click();
  await expect(backups.getByText('备份已完成并保存在本机。', { exact: false })).toBeVisible();
  await expect(backups.getByText('备份已保存，但列表刷新失败。')).toBeVisible();
  await expect(backups.getByText('无法读取备份列表，请重试。')).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-backups')!).length),
  ).toBe(1);
  await page.evaluate(() => localStorage.removeItem('fixture-backup-list-fails'));
  await backups.getByRole('button', { name: '重试读取备份列表' }).click();
  await expect(backups.locator('.backup-row')).toHaveCount(1);
});

test('unsaved context is protected when closing settings or navigating to channels', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const context = page.getByRole('spinbutton', { name: '上下文窗口上限' });
  await context.fill('200000');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '继续编辑', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(context).toHaveValue('200000');
  await page.getByRole('button', { name: '管理渠道', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '渠道管理', exact: true })).toBeVisible();
});

test('failed settings save stays in the dialog and can be retried without losing edits', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const original = window.__FLUX_TEST_BRIDGE__!.connect;
    window.__FLUX_TEST_BRIDGE__!.connect = async (...args) => {
      const calls = Number(localStorage.getItem('fixture-connect-calls') ?? 0) + 1;
      localStorage.setItem('fixture-connect-calls', String(calls));
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (calls === 1) throw new Error('fixture connection rejected');
      return original(...args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const context = page.getByRole('spinbutton', { name: '上下文窗口上限' });
  await context.fill('100000');
  await page.locator('.settings-dialog form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  const dialog = page.getByRole('dialog', { name: '工作空间设置' });
  await expect(dialog.getByRole('alert')).toContainText('无法连接');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(context).toHaveValue('100000');
  expect(await page.evaluate(() => localStorage.getItem('fixture-connect-calls'))).toBe('1');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('fixture-connect-calls'))).toBe('2');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-settings')!).contextWindow),
  ).toBe(100000);
});

test('appearance changes persist immediately while abandoned context edits do not', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('spinbutton', { name: '上下文窗口上限' }).fill('100000');
  await choose(page.getByRole('combobox', { name: '界面字号' }), '18');
  await expect(page.locator('html')).toHaveCSS('--font-size', '18px');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '上下文窗口上限' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: '界面字号' })).toHaveAttribute(
    'data-value',
    '18',
  );
});

test('saving connection settings does not block an independent font preference', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const original = window.__FLUX_TEST_BRIDGE__!.connect;
    window.__FLUX_TEST_BRIDGE__!.connect = async (...args) => {
      await new Promise<void>((resolve) => {
        (window as typeof window & { releaseConnection?: () => void }).releaseConnection = resolve;
      });
      return original(...args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('spinbutton', { name: '上下文窗口上限' }).fill('100000');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.locator('.settings-dialog button[type="submit"]')).toBeDisabled();
  const font = page.getByRole('combobox', { name: '界面字号' });
  await expect(font).toBeEnabled();
  await choose(font, '18');
  await expect(page.locator('html')).toHaveCSS('--font-size', '18px');
  await page.evaluate(() =>
    (window as typeof window & { releaseConnection?: () => void }).releaseConnection?.(),
  );
  await expect(page.getByRole('dialog', { name: '工作空间设置' })).toHaveCount(0);
});

test('canceling export leaves task actions open for the next action', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('export cancellation');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.exportDocument = async () => false;
  });
  await page.getByRole('button', { name: '整理任务 export cancellation', exact: true }).click();
  await page.getByRole('button', { name: '导出文档', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '整理任务', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出文档', exact: true })).toBeEnabled();
});

test('a channel draft survives closing and reopening without saving credentials to browser storage', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://draft.example/v1');
  await page.getByLabel('访问密钥', { exact: true }).fill('volatile-channel-secret');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await expect(page.getByLabel('服务地址', { exact: true })).toHaveValue(
    'https://draft.example/v1',
  );
  await expect(page.getByLabel('访问密钥', { exact: true })).toHaveValue('volatile-channel-secret');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(
    'volatile-channel-secret',
  );
});

test('large imported catalogues stay complete and models can be searched directly', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.discoverProvider = async () => ({
      models: Array.from({ length: 350 }, (_, i) => `model-${i}`),
      latencyMs: 1,
    });
  });
  await page.getByRole('button', { name: '渠道管理', exact: true }).click();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://large.example/v1');
  await page.getByRole('button', { name: '导入并使用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('fixture-profiles')!)[0].models.length,
    ),
  ).toBe(350);
  await page.getByRole('combobox', { name: '当前会话模型' }).click();
  await page.getByRole('combobox', { name: '搜索模型' }).fill('model-349');
  await page.locator('.select-item[data-value="model-349"]').click();
  await expect(page.getByRole('combobox', { name: '当前会话模型' })).toHaveAttribute(
    'data-value',
    'model-349',
  );
});

test('Enter queues during execution and terminal shortcuts stay in the terminal', async ({
  page,
}) => {
  await setup(page);
  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('long-running');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await input.fill('queued-by-enter');
  await input.press('Enter');
  await expect(page.locator('.queued-messages')).toContainText('queued-by-enter');
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+n');
  await page.keyboard.press('Control+,');
  await page.keyboard.press('Control+`');
  await expect(page.getByRole('dialog', { name: '命令面板' })).toHaveCount(0);
  await expect(page.locator('.interactive-terminal')).toBeVisible();
});

test('terminal foreground recovery synchronizes PTY dimensions without recreating the session', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await expect(page.locator('.xterm-helper-textarea')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('fixture-terminal-resizes') ?? '[]').length,
      ),
    )
    .toBeGreaterThan(0);
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fixture-terminal-resizes') ?? '[]'),
  );
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('fixture-terminal-resizes') ?? '[]').length,
      ),
    )
    .toBeGreaterThan(before.length);
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fixture-terminal-resizes') ?? '[]'),
  );
  expect(after.at(-1).processId).toBe(before.at(-1).processId);
  expect(after.at(-1).size.rows).toBeGreaterThan(0);
  expect(after.at(-1).size.cols).toBeGreaterThan(0);
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await page.evaluate(() => localStorage.removeItem('fixture-terminal-resizes'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-terminal-resizes') ?? '[]')),
  ).toEqual([]);
});

test('composer keeps Windows IME commits and editor shortcuts inside the input', async ({
  page,
}) => {
  await setup(page);
  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('输入法候选');
  await input.focus();
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务描述"]');
    if (!editor) throw new Error('Composer input is missing');
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  await expect(input).toHaveValue('输入法候选');
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
  await input.press('Control+k');
  await input.press('Control+,');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('输入法候选\n');
  await page.waitForTimeout(120);
  await input.press('Enter');
  await expect(page.getByText('任务完成，已验证。')).toBeVisible();
});

async function choose(control: import('@playwright/test').Locator, value: string) {
  await control.click();
  await control.page().locator(`.select-item[data-value="${value}"]`).click();
}

test('modern selects support keyboard, cancellation and focus inside the settings dialog', async ({
  page,
}) => {
  await setup(page);
  const effort = page.getByRole('combobox', { name: '推理强度' });
  await effort.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: '模型默认', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: '最高', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(effort).toHaveAttribute('data-value', 'max');
  await expect(effort).toBeFocused();
  await effort.press('Enter');
  await expect(page.getByRole('option', { name: '最高', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await expect(effort).toHaveAttribute('data-value', 'max');
  await expect(effort).toBeFocused();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const theme = page.getByRole('combobox', { name: '主题', exact: true });
  await theme.click();
  await expect(page.getByRole('option', { name: '暗色', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(theme).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('channels remain readable in both themes at large type', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 960, height: 720 });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await choose(page.getByRole('combobox', { name: '界面字号' }), '18');
    await choose(page.getByRole('combobox', { name: '主题', exact: true }), theme);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '渠道管理', exact: true }).click();
    await page.getByRole('button', { name: '添加渠道', exact: true }).click();
    await page.getByLabel('服务地址', { exact: true }).fill('https://display.example/v1');
    await page.getByText('模型与连接选项（可选）', { exact: true }).click();
    await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
    await expect(page.getByRole('list', { name: '服务模型' })).toContainText('other-model');
    await page.getByRole('button', { name: '导入并使用', exact: true }).scrollIntoViewIfNeeded();
    const bounds = await page
      .locator('.channels-body')
      .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await page.screenshot({ path: `test-results/channels-${theme}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.keyboard.press('Escape');
  }
});

test('command palette navigates tasks and does not let global shortcuts escape dialogs', async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible();
  await page.getByRole('combobox', { name: '搜索命令或任务' }).fill('工作空间设置');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '工作空间设置' })).toBeVisible();
  await page.keyboard.press('Control+n');
  await expect(page.getByRole('dialog', { name: '工作空间设置' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('workspace files with Unicode and spaces open through the system command', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.getByRole('button', { name: '使用默认应用打开文件' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-open-workspace-file')))
    .toContain('README.md');
  await page.getByRole('button', { name: '返回文件列表' }).click();

  const input = page.getByRole('textbox', { name: '任务描述' });
  await input.fill('[设计文档](docs/%E8%AE%BE%E8%AE%A1%20%E6%96%87%E6%A1%A3.md)');
  await input.press('Enter');
  await page.locator('.user-message').getByRole('button', { name: '设计文档' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('fixture-open-workspace-file') ?? '{}')),
    )
    .toEqual({ root: 'D:\\Fixtures\\sample-project', relative: 'docs/设计 文档.md' });
});

test('code editor supports undo, save, and explicit external-conflict resolution', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
  await editor.press('Control+k');
  await editor.press('Control+n');
  await editor.press('Control+,');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(editor).toBeVisible();
  await editor.fill('local edit');
  await editor.press('Control+z');
  await expect(editor).toContainText('Sample project');
  await editor.fill('my final edit');
  await page.evaluate(() => localStorage.setItem('fixture-file', 'external change'));
  await editor.press('Control+s');
  await expect(page.getByRole('textbox', { name: '磁盘版本', exact: true })).toContainText(
    'external change',
  );
  const merged = page.getByRole('textbox', { name: '合并结果', exact: true });
  await expect(merged).toContainText('my final edit');
  await merged.fill('external change + my final edit');
  await merged.press('Control+s');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-file')))
    .toBe('external change + my final edit');
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText(
    'external change + my final edit',
  );
});

test('editor flushes drafts on immediate close and preserves Windows line endings', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => localStorage.setItem('fixture-file', 'first\r\nsecond\r\n'));
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
  await editor.fill('changed\nsecond\n');
  await page.locator('.file-editor').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(editor).toContainText('changed');
  await editor.press('Control+s');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-file')))
    .toBe('changed\r\nsecond\r\n');
});

test('diff review separates staged content and sends a bounded hunk action', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.gitAction = async (_root, action) => {
      localStorage.setItem('fixture-git-action', JSON.stringify(action));
      return '';
    };
  });
  await page.getByRole('button', { name: '变更', exact: false }).first().click();
  await page.getByRole('button', { name: '修改 src/main.ts', exact: true }).click();
  await page.getByRole('button', { name: '暂存此差异块', exact: true }).waitFor();
  await page.screenshot({ path: 'work/windows-hunk-review.png', animations: 'disabled' });
  await page.getByRole('button', { name: '暂存此差异块', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('fixture-git-action') ?? '{}').type),
    )
    .toBe('hunk');
  await page.getByRole('button', { name: '已暂存', exact: true }).click();
  await expect(page.getByText('没有文本差异（文件可能为二进制或仅权限发生变化）。')).toBeVisible();
});

test('diff line numbers select individual changes for staging', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.gitAction = async (_root, action) => {
      localStorage.setItem('fixture-git-action', JSON.stringify(action));
      return '';
    };
  });
  await page.getByRole('button', { name: '变更', exact: false }).first().click();
  await page.getByRole('button', { name: '修改 src/main.ts', exact: true }).click();
  const lines = page.getByRole('button', { name: /选择要暂存的差异行/ });
  await expect(lines).toHaveCount(2);
  await lines.nth(1).click();
  await expect(lines.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /暂存所选行/ }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fixture-git-action') ?? '{}')))
    .toMatchObject({ type: 'lines', selected: [1], staged: false, index: 0 });
});

test('Git conflict workflow shows resolution choices and guards continuation', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.gitBranches = async () => ({
      current: 'main',
      branches: ['main', 'feature'],
    });
    window.__FLUX_TEST_BRIDGE__!.gitOperation = async () => ({
      kind: 'merge',
      conflicts: ['src/main.ts'],
      dirty: true,
    });
    window.__FLUX_TEST_BRIDGE__!.gitAction = async (_root, action) => {
      localStorage.setItem('fixture-git-action', JSON.stringify(action));
      return '';
    };
  });
  await page.getByRole('button', { name: '变更', exact: false }).first().click();
  await expect(page.getByText('正在合并')).toBeVisible();
  await expect(page.getByRole('button', { name: '继续操作' })).toBeDisabled();
  await page.getByRole('button', { name: '保留当前版本' }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fixture-git-action') ?? '{}')))
    .toMatchObject({ type: 'resolveConflict', path: 'src/main.ts', version: 'ours' });
});

test('manual Git conflict editing keeps all three versions and stages the saved result', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.gitBranches = async () => ({
      current: 'main',
      branches: ['main', 'feature'],
    });
    window.__FLUX_TEST_BRIDGE__!.gitOperation = async () => ({
      kind: 'merge',
      conflicts: ['src/main.ts'],
      dirty: true,
    });
    window.__FLUX_TEST_BRIDGE__!.gitAction = async (_root, action) => {
      localStorage.setItem('fixture-git-action', JSON.stringify(action));
      if (action.type === 'resolveEdited') {
        const current = localStorage.getItem('fixture-file') ?? '# Sample project\nUTF-8 中文预览';
        if (action.expected !== current) throw new Error('The file changed on disk');
        localStorage.setItem('fixture-file', action.content);
      }
      return '';
    };
  });
  await page.getByRole('button', { name: '变更', exact: false }).first().click();
  await page.getByRole('button', { name: '手动编辑' }).click();
  const dialog = page.getByRole('dialog', { name: '解决 Git 冲突' });
  await expect(dialog.getByText('base\n')).toBeVisible();
  await expect(dialog.getByText('current\n')).toBeVisible();
  await expect(dialog.getByText('incoming\n')).toBeVisible();
  await dialog.getByRole('button', { name: '保留两者' }).click();
  await expect(dialog.getByRole('textbox', { name: '合并结果' })).toHaveValue(
    'current\nincoming\n',
  );
  await dialog.getByRole('button', { name: '保存并标记已解决' }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-file')))
    .toBe('current\nincoming\n');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fixture-git-action') ?? '{}')))
    .toMatchObject({ type: 'resolveEdited', path: 'src/main.ts', content: 'current\nincoming\n' });
});

test('failed draft storage stays visible and does not close the editor', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('fluxcode.editor-drafts'))
        throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByRole('textbox', { name: '文件内容', exact: true }).fill('preserve this');
  await page.locator('.file-editor').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText(
    'preserve this',
  );
  await expect(page.getByText('草稿未能保存在本机，请保存文件或重试。')).toBeVisible();
  await page.getByRole('button', { name: '另存当前编辑' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('fixture-export') ?? '{}').content),
    )
    .toBe('preserve this');
  await page.getByRole('button', { name: '切换文件面板', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText(
    'preserve this',
  );
  await page.getByRole('button', { name: '新建任务 Ctrl N', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText(
    'preserve this',
  );
  await expect(page.getByText('未保存编辑已保存在本机，重新打开文件可继续。')).toHaveCount(0);
  await page.getByRole('textbox', { name: '文件内容', exact: true }).press('Control+s');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-file')))
    .toBe('preserve this');
  await expect(
    page.getByText('文件已保存，但旧草稿未能清理。重新打开时请核对文件内容。'),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: '磁盘版本', exact: true })).toHaveCount(0);
});

test('long history has bounded mounted messages and can jump to the latest item', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('long history');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.evaluate(() => localStorage.setItem('fixture-long-history', 'true'));
  await page.reload();
  await expect(page.locator('.assistant-message').first()).toBeVisible();
  expect(await page.locator('.assistant-message').count()).toBeLessThan(40);
  await page.locator('.conversation-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.getByText('History message 0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回到最新消息' }).click();
  await expect(page.getByText('History message 1999', { exact: true })).toBeVisible();
  expect(await page.locator('.assistant-message').count()).toBeLessThan(40);
});

test('updates remain an offline placeholder without network actions', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('应用更新', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: '检查更新（暂未开放）', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('当前为本地离线工具，应用不会检查或下载更新。')).toBeVisible();
  await expect(page.getByText('已是最新版本', { exact: true })).toHaveCount(0);
});

test('an ambiguous send reconciles the active turn without replaying the draft', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('accepted-but-timeout');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('accepted-but-timeout');
  await expect(page.getByRole('combobox', { name: '推理强度' })).toBeDisabled();
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '推理强度' })).toBeEnabled();
});

test('forking preserves the source and creates an independent task', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('source task');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.getByRole('button', { name: '整理任务 source task', exact: true }).click();
  await page.getByRole('button', { name: '从此任务创建分支', exact: true }).click();
  await expect(page.locator('.task-select')).toHaveCount(2);
  await expect(page.locator('.assistant-message')).toContainText('恢复成功');
  const tasks = await page.evaluate(
    () => JSON.parse(localStorage.getItem('fluxcode.catalog.v1')!).tasks,
  );
  expect(new Set(tasks.map((task: { id: string }) => task.id)).size).toBe(2);
  expect(tasks[0].forkedFrom).toBe(tasks[1].id);
  await expect(page.locator('.task-fork-icon')).toHaveCount(1);
});

test('multiple terminals can exist for the same project and survive hiding the dock', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await page.getByRole('button', { name: '新建终端', exact: true }).click();
  await expect(page.locator('.terminal-tabs span')).toHaveCount(2);
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await page.getByRole('button', { name: '切换终端', exact: true }).click();
  await expect(page.locator('.terminal-tabs span')).toHaveCount(2);
});

test('panel sizing supports keyboard adjustment, reset, and persistence', async ({ page }) => {
  await setup(page);
  const handle = page.getByRole('separator', { name: '调整文件面板宽度' });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '310');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-inspector-width')))
    .toBe('310');
  await page.reload();
  await expect(page.locator('.inspector')).toHaveCSS('width', '310px');
  await handle.dblclick();
  await expect(page.locator('.inspector')).toHaveCSS('width', '294px');
});

test('conversation import previews conflicts, stays read-only and remains searchable after reload', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.readDocument = async () =>
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            project: { name: 'Imported project', path: 'D:/old-work' },
            task: { id: 'source-id', title: 'Archived plan', updatedAt: 42 },
            messages: [
              {
                id: 'import-message',
                kind: 'assistant',
                text: 'A uniquely searchable imported answer',
              },
            ],
          },
        ],
      });
  });
  await page.getByRole('button', { name: '导入对话' }).click();
  await page.getByRole('button', { name: '选择 JSON 文件' }).click();
  const dialog = page.getByRole('dialog', { name: '导入对话' });
  await expect(dialog).toContainText('Archived plan');
  await expect(dialog).toContainText('1 条消息');
  await dialog.getByRole('button', { name: '导入对话' }).click();
  await expect(page.getByText('A uniquely searchable imported answer')).toBeVisible();
  await expect(page.getByText('导入的历史仅供阅读和搜索，不能继续原引擎会话。')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('A uniquely searchable imported answer')).toBeVisible();
  await page.getByRole('button', { name: '搜索对话正文' }).click();
  await page.getByRole('textbox', { name: '搜索词' }).fill('uniquely searchable');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '搜索对话正文' })).toContainText('Archived plan');

  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => {
    window.__FLUX_TEST_BRIDGE__!.readDocument = async () =>
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            project: { name: 'Imported project', path: 'D:/old-work' },
            task: { id: 'source-id', title: 'Archived plan', updatedAt: 42 },
            messages: [
              {
                id: 'import-message',
                kind: 'assistant',
                text: 'A uniquely searchable imported answer',
              },
            ],
          },
        ],
      });
  });
  await page.getByRole('button', { name: '导入对话' }).click();
  await page.getByRole('button', { name: '选择 JSON 文件' }).click();
  await expect(page.getByRole('dialog', { name: '导入对话' })).toContainText('已导入，将跳过');
});

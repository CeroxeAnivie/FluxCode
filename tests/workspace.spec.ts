import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Event = { method: string; params?: Record<string, unknown> };
    const listeners = new Set<(e: Event) => void>();
    const emit = (e: Event) => listeners.forEach((listener) => listener(e));
    const settings = {
      baseUrl: 'https://example.com/v1',
      model: 'fixture-model',
      apiKeyEnv: 'TEST_KEY',
      proxyUrl: 'http://127.0.0.1:14455/',
    };
    let counter = 0;
    window.__FLUX_TEST_BRIDGE__ = {
      available: true,
      loadSettings: async () => settings,
      loadPreferences: async () => ({
        font_size: Number(localStorage.getItem('fixture-font-size') ?? 14),
        sidebar_width: 246,
        inspector_width: 294,
      }),
      saveFontSize: async (size) => {
        localStorage.setItem('fixture-font-size', String(size));
      },
      connect: async () => ({ version: '0.156.1' }),
      forgetApiKey: async () => {},
      openUserFile: async () => {},
      subscribe: async (handler) => {
        listeners.add(handler);
        return () => {
          listeners.delete(handler);
        };
      },
      chooseDirectory: async () => 'D:\\Fixtures\\sample-project',
      listFiles: async (_root, relative) =>
        relative
          ? [{ name: 'main.ts', path: 'src/main.ts', directory: false }]
          : [
              { name: 'src', path: 'src', directory: true },
              { name: 'README.md', path: 'README.md', directory: false },
            ],
      readFile: async () => '# Sample project\nUTF-8 中文预览',
      repoStatus: async () => ({
        branch: 'main',
        git: true,
        changes: [{ path: 'src/main.ts', status: ' M' }],
      }),
      fileDiff: async (_root, _relative, staged) => (staged ? '' : '-old\n+new'),
      executeTerminal: async (_cwd, command, processId) => {
        emit({
          method: 'command/exec/outputDelta',
          params: { processId, deltaBase64: btoa('terminal-ok\n') },
        });
        return { exitCode: command === 'fail' ? 1 : 0, stdout: '', stderr: '' };
      },
      rpc: async <T>(method: string, params: object): Promise<T> => {
        if (method === 'turn/start')
          localStorage.setItem('fixture-last-turn', JSON.stringify(params));
        const p = params as Record<string, unknown>;
        if (method === 'thread/start') return { thread: { id: `thread-${++counter}` } } as T;
        if (method === 'thread/resume')
          return {
            thread: {
              historyMode: 'legacy',
              turns: [
                {
                  id: 'turn-old',
                  status: 'completed',
                  items: [
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
          if (text === 'trigger-failure') throw new Error('模拟服务不可用');
          emit({ method: 'turn/started', params: { threadId, turn: { id: 'turn-1' } } });
          emit({
            method: 'item/completed',
            params: { threadId, item: { type: 'userMessage', id: 'u-1', content: [{ text }] } },
          });
          if (text !== 'long-running')
            setTimeout(() => {
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
                params: { threadId, turn: { id: 'turn-1', status: 'completed' } },
              });
            }, 50);
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

async function setup(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '保存并连接' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('model and effort belong to a conversation, survive reload and failure, and new tasks start Off', async ({
  page,
}) => {
  await setup(page);
  const model = page.getByRole('combobox', { name: '当前会话模型' });
  const effort = page.getByRole('combobox', { name: '推理强度' });
  await expect(effort).toHaveValue('off');
  await model.selectOption('__custom__');
  await page.getByRole('textbox', { name: '模型 ID', exact: true }).fill('custom-model');
  await page.getByRole('button', { name: '使用模型' }).click();
  await effort.selectOption('high');
  await page.getByRole('textbox', { name: '任务描述' }).fill('task-with-high');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成');
  await page.getByRole('button', { name: '新建任务 Ctrl N', exact: true }).click();
  await expect(model).toHaveValue('custom-model');
  await expect(effort).toHaveValue('off');
  await page.getByRole('button', { name: 'task-with-high', exact: true }).click();
  await expect(effort).toHaveValue('high');
  await effort.selectOption('none');
  await page.reload();
  await page.getByRole('button', { name: 'task-with-high', exact: true }).click();
  await expect(model).toHaveValue('custom-model');
  await expect(effort).toHaveValue('none');
  await expect(effort).toBeEnabled();
  await effort.selectOption('off');
  await page.getByRole('textbox', { name: '任务描述' }).fill('trigger-failure');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.error-banner')).toContainText('模拟服务不可用');
  await expect(effort).toHaveValue('off');
  const sent = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-last-turn')!));
  expect(sent.model).toBe('custom-model');
  expect(sent.collaborationMode.settings.reasoning_effort).toBeNull();
  expect(sent).not.toHaveProperty('effort');
});

test('running selections are locked and typography persists at narrow widths', async ({ page }) => {
  await setup(page);
  await page.getByRole('combobox', { name: '推理强度' }).selectOption('medium');
  await page.getByRole('textbox', { name: '任务描述' }).fill('long-running');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.getByRole('combobox', { name: '推理强度' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '当前会话模型' })).toBeDisabled();
  await page.getByRole('button', { name: '停止任务' }).click();
  await expect(page.getByRole('combobox', { name: '推理强度' })).toBeEnabled();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('combobox', { name: '界面字号' }).selectOption('18');
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
  await page.getByRole('button', { name: 'src/main.ts M' }).click();
  await expect(page.getByText('+new', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换终端' }).click();
  await page.getByRole('textbox', { name: '终端命令' }).fill('echo terminal-ok');
  await page.getByRole('button', { name: '执行命令' }).click();
  await expect(page.locator('.terminal-output')).toContainText('[退出码 0]');
  await page.screenshot({ path: 'test-results/workspace.png' });
});

test('real task UI streams, persists metadata and resumes after reload', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: '任务描述' }).fill('分析项目');
  await page.getByRole('button', { name: '发送任务' }).click();
  await expect(page.locator('.assistant-message')).toContainText('任务完成，已验证。');
  await expect(page.locator('.user-message')).toContainText('分析项目');
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '保存并连接' }).click();
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
  await expect(page.locator('.error-banner')).toContainText('模拟服务不可用');
  await expect(page.getByRole('textbox', { name: '任务描述' })).toHaveValue('trigger-failure');
});

test('empty workspace and narrow desktop layout have no horizontal overflow', async ({ page }) => {
  await page.screenshot({ path: 'test-results/welcome.png' });
  await page.setViewportSize({ width: 960, height: 680 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(960);
  await page.getByRole('button', { name: '设置' }).click();
  await page.screenshot({ path: 'test-results/settings.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

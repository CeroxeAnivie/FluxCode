import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, english = false) {
  await page.addInitScript((english) => {
    const callbacks = new Set<
      (event: { method: string; params?: Record<string, unknown> }) => void
    >();
    window.addEventListener('fixture-agent-event', (event) => {
      for (const callback of callbacks) callback((event as CustomEvent).detail);
    });
    localStorage.setItem(
      'fluxcode.appearance.v1',
      JSON.stringify({ language: english ? 'en' : 'zh-CN', theme: 'dark' }),
    );
    localStorage.setItem(
      'fluxcode.catalog.v1',
      JSON.stringify({
        version: 1,
        projects: [{ id: 'project', name: 'Fixture', path: 'C:/fixture' }],
        tasks: [
          {
            id: 'parent',
            projectId: 'project',
            title: 'Parent task',
            updatedAt: 1,
            archived: false,
          },
          { id: 'other', projectId: 'project', title: 'Other task', updatedAt: 0, archived: false },
        ],
      }),
    );
    localStorage.setItem(
      'fluxcode.workspace.v1',
      JSON.stringify({
        version: 1,
        projectId: 'project',
        taskId: 'parent',
        drafts: {},
        selections: {},
        positions: {},
        panels: { sidebar: true, inspector: false, terminal: false },
      }),
    );
    window.__FLUX_TEST_BRIDGE__ = {
      available: true,
      subscribe: async (
        handler: (event: { method: string; params?: Record<string, unknown> }) => void,
      ) => {
        callbacks.add(handler);
        return () => {
          callbacks.delete(handler);
        };
      },
      loadSettings: async () => ({
        baseUrl: 'https://example.test/v1',
        model: 'fixture',
        apiKeyEnv: 'TEST_KEY',
        proxyUrl: '',
      }),
      listProviderProfiles: async () => [],
      loadPreferences: async () => ({ font_size: 14, sidebar_width: 260, inspector_width: 440 }),
      savePanelWidth: async () => {},
      connect: async () => ({ version: 'fixture' }),
      rpc: async (method: string, params: object) => {
        const p = params as { threadId?: string; includeTurns?: boolean };
        const calls = JSON.parse(localStorage.getItem('fixture-calls') ?? '[]');
        calls.push({ method, ...p });
        localStorage.setItem('fixture-calls', JSON.stringify(calls));
        if (method === 'thread/resume')
          return {
            thread: {
              turns: [
                {
                  id: 'parent-turn',
                  status: 'completed',
                  items:
                    p.threadId === 'other'
                      ? []
                      : [
                          { type: 'reasoning', id: 'reason', summary: ['**Planning agents**'] },
                          {
                            type: 'collabAgentToolCall',
                            id: 'spawn',
                            tool: 'spawnAgent',
                            status: 'completed',
                            receiverThreadIds: ['child-a', 'child-b'],
                            prompt: 'Review the project',
                            agentsStates: {
                              'child-a': { status: 'pendingInit' },
                              'child-b': { status: 'running' },
                            },
                          },
                        ],
                },
                ...JSON.parse(localStorage.getItem('fixture-saved-turns') ?? '[]'),
              ],
            },
          };
        if (method === 'thread/list') return { data: [], nextCursor: null };
        if (method === 'thread/turns/list')
          return { data: [{ id: 'child-turn', status: 'completed', items: [] }], nextCursor: null };
        if (method === 'thread/read') {
          if (localStorage.getItem('fixture-read-fails') === p.threadId)
            throw new Error('fixture read failure');
          if (p.threadId === 'child-a' && p.includeTurns && localStorage.getItem('fixture-delay'))
            await new Promise((resolve) => setTimeout(resolve, 600));
          const complete = localStorage.getItem('fixture-complete') === p.threadId;
          return {
            thread: {
              id: p.threadId,
              model: 'fixture-child-model',
              agentNickname: p.threadId === 'child-a' ? 'Reviewer' : 'Builder',
              status: { type: complete ? 'idle' : 'active' },
              turns: p.includeTurns
                ? [
                    {
                      id: 'child-turn',
                      status: complete ? 'completed' : 'inProgress',
                      items: [
                        { id: 'child-reason', type: 'reasoning', summary: ['**Inspecting code**'] },
                        {
                          id: 'child-command',
                          type: 'commandExecution',
                          command: 'git status',
                          status: 'completed',
                          aggregatedOutput: 'clean tree',
                          exitCode: 0,
                        },
                        {
                          id: 'child-answer',
                          type: 'agentMessage',
                          text: `${p.threadId} response`,
                        },
                      ],
                    },
                  ]
                : [],
            },
          };
        }
        return {};
      },
    } as unknown as NonNullable<typeof window.__FLUX_TEST_BRIDGE__>;
  }, english);
  await page.goto('/');
  await expect(page.locator('.sidebar-agent')).toHaveCount(2);
  await expect(page.locator('.sidebar-agent').first()).toContainText('Reviewer');
}

test('sidebar shows children and opens live messages, reasoning and tool output without switching the parent', async ({
  page,
}) => {
  await fixture(page);
  const row = page.locator('.sidebar-agent').first();
  await expect(row).toContainText('运行中');
  await row.click();
  const panel = page.getByRole('complementary', { name: '子智能体详情' });
  await expect(panel).toContainText('child-a response');
  await expect(panel.locator('.message-label')).toContainText('fixture-child-model');
  await panel.getByText('思考过程', { exact: true }).click();
  await expect(panel.locator('strong').filter({ hasText: 'Inspecting code' })).toBeVisible();
  await panel.getByText('git status', { exact: true }).click();
  await expect(panel).toContainText('clean tree');
  await expect(page.locator('.task-row.active')).toContainText('Parent task');
  await expect(page.locator('.main-workspace')).not.toContainText('child-a response');
  await expect(page.locator('.main-workspace')).not.toContainText('状态未知');
  await expect(page.locator('.main-workspace')).not.toContainText('child-a');
  await page.getByRole('separator', { name: '调整子智能体面板宽度' }).press('ArrowLeft');
  await page.screenshot({ path: 'test-results/subagent-panel.png' });
  await panel.getByRole('button', { name: '关闭子智能体详情' }).click();
  await expect(panel).toHaveCount(0);
  await expect(row).toBeFocused();
  const calls = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-calls')!));
  expect(
    calls.filter(
      (call: { method: string; threadId: string }) =>
        call.threadId?.startsWith('child') && call.method !== 'thread/read',
    ),
  ).toEqual([]);
});

test('late reads never replace a different child and parent navigation closes the panel', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => localStorage.setItem('fixture-delay', 'true'));
  await page.locator('.sidebar-agent').first().click();
  await page.locator('.sidebar-agent').nth(1).click();
  const panel = page.getByRole('complementary', { name: '子智能体详情' });
  await expect(panel).toContainText('child-b response');
  await page.waitForTimeout(800);
  await expect(panel).not.toContainText('child-a response');
  await page.getByRole('button', { name: 'Other task', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.sidebar-agent')).toHaveCount(0);
});

test('read failure is visible and retry restores content without declaring the agent failed', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => localStorage.setItem('fixture-read-fails', 'child-a'));
  await page.locator('.sidebar-agent').first().click();
  const panel = page.getByRole('complementary', { name: '子智能体详情' });
  await expect(panel.getByRole('alert')).toContainText('fixture read failure');
  await expect(panel.locator('.agent-status')).toContainText('运行中');
  await page.evaluate(() => localStorage.removeItem('fixture-read-fails'));
  await panel.getByRole('button', { name: '重试', exact: true }).click();
  await expect(panel).toContainText('child-a response');
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('events buffered during hydration preserve streamed output and terminal status', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => localStorage.setItem('fixture-delay', 'true'));
  await page.locator('.sidebar-agent').first().click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('fixture-calls')!).some(
          (call: { threadId: string; includeTurns: boolean }) =>
            call.threadId === 'child-a' && call.includeTurns,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    for (const event of [
      {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'child-a',
          turnId: 'child-turn',
          itemId: 'child-answer',
          delta: ' streamed suffix',
        },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'child-a', turn: { id: 'child-turn', status: 'completed' } },
      },
    ])
      window.dispatchEvent(new CustomEvent('fixture-agent-event', { detail: event }));
    localStorage.setItem('fixture-complete', 'child-a');
  });
  const panel = page.getByRole('complementary', { name: '子智能体详情' });
  await expect(panel).toContainText('child-a response streamed suffix');
  await expect(panel.locator('.agent-status')).toContainText('已完成');
});

test('English subagent controls and reasoning render without Chinese UI text', async ({ page }) => {
  await fixture(page, true);
  await page.locator('.sidebar-agent').first().click();
  const panel = page.getByRole('complementary', { name: 'Subagent details' });
  await expect(panel).toContainText('child-a response');
  await expect(panel.getByRole('button', { name: 'Refresh subagent' })).toBeVisible();
  expect(await panel.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await panel.getByRole('button', { name: 'Close subagent details' }).press('Escape');
  await expect(panel).toHaveCount(0);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`activity dots visibly animate with ${reducedMotion} and retain model + working + elapsed time`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await fixture(page);
    await page.locator('.sidebar-agent').first().click();
    const panel = page.getByRole('complementary', { name: '子智能体详情' });
    const indicator = panel.locator('.working-indicator');
    await expect(indicator).toContainText('fixture-child-model 正在处理');
    await expect(indicator).not.toContainText('FluxCode');
    const dot = indicator.locator('.working-dot').first();
    const initial = await dot.evaluate((element) => ({
      opacity: getComputedStyle(element).opacity,
      animation: getComputedStyle(element).animationName,
      duration: getComputedStyle(element).animationDuration,
    }));
    expect(initial.animation).not.toBe('none');
    expect(parseFloat(initial.duration)).toBeGreaterThan(0.5);
    await expect
      .poll(async () => dot.evaluate((element) => getComputedStyle(element).opacity))
      .not.toBe(initial.opacity);
    await expect(indicator.locator('time')).not.toHaveText('0:00');
  });
}

test('restored messages use the recorded model for each turn, never the current channel or product name', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'fluxcode.turn-identities.parent',
      JSON.stringify({
        'saved-turn-a': { model: 'model-a' },
        'saved-turn-b': { model: 'model-b' },
      }),
    );
    localStorage.setItem(
      'fixture-saved-turns',
      JSON.stringify([
        {
          id: 'saved-turn-a',
          status: 'completed',
          items: [{ type: 'agentMessage', id: 'message-a', text: 'First answer' }],
        },
        {
          id: 'saved-turn-b',
          status: 'completed',
          items: [{ type: 'agentMessage', id: 'message-b', text: 'Second answer' }],
        },
      ]),
    );
  });
  await fixture(page);
  await expect(page.locator('.main-workspace .message-label strong')).toHaveText([
    'model-a',
    'model-b',
  ]);
  await page.reload();
  await expect(page.locator('.main-workspace .message-label strong')).toHaveText([
    'model-a',
    'model-b',
  ]);
});

test('native acrylic uses a thick consistent tint and honors the opaque accessibility fallback', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    document.documentElement.dataset.material = 'acrylic';
  });
  const opacity = async (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const context = document.createElement('canvas').getContext('2d')!;
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] / 255;
    });
  for (const selector of ['.sidebar', '.titlebar', '.navigation-rail', '.main-workspace'])
    expect(await opacity(selector)).toBeCloseTo(0.9, 1);
  expect(await opacity('.workspace-header')).toBe(0);
  expect(await opacity('.composer')).toBe(1);
  await page.emulateMedia({ forcedColors: 'active' });
  expect(await opacity('.main-workspace')).toBe(1);
  expect(await opacity('.sidebar')).toBe(1);
});

test('panels transition both ways, reverse safely, and do not animate settled resizing', async ({
  page,
}) => {
  await fixture(page);
  await page.locator('.sidebar-agent').first().click();
  const panel = page.getByRole('complementary', { name: '子智能体详情' });
  await expect(panel).toContainText('child-a response');
  const motion = page.locator('.motion-panel').filter({ has: page.locator('.subagent-panel') });
  await expect(motion).toHaveAttribute('data-moving', 'false');
  expect(await motion.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  const before = (await motion.boundingBox())!.width;
  await panel.getByRole('button', { name: '关闭子智能体详情' }).click();
  await expect(motion).toHaveAttribute('inert', '');
  await expect.poll(async () => (await motion.boundingBox())?.width ?? 0).toBeLessThan(before);
  await page.locator('.sidebar-agent').first().click();
  await expect(panel).toBeVisible();
  await expect(motion).toHaveAttribute('data-moving', 'false');
  expect((await motion.boundingBox())!.width).toBe(before);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await panel.getByRole('button', { name: '关闭子智能体详情' }).click();
  await expect(panel).toHaveCount(0);
});

test('native disclosure sections animate their height and respect reduced motion', async ({
  page,
}) => {
  await fixture(page);
  const disclosure = page.locator('.main-workspace details').first();
  await disclosure.locator('summary').click();
  await expect(disclosure).toHaveAttribute('open', '');
  const normal = await disclosure.evaluate(
    (el) => getComputedStyle(el, '::details-content').transitionDuration,
  );
  expect(normal).toContain('0.16s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await disclosure.evaluate((el) => getComputedStyle(el, '::details-content').transitionDuration),
  ).toBe('0s');
});

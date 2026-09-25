import { expect, test, type Page } from '@playwright/test';
import type { ProviderProfile } from '../src/domain/provider';

type DiscoveryReply = {
  models?: string[];
  latencyMs?: number;
  duplicateModels?: number;
  error?: string;
};

async function openChannel(page: Page, replies: DiscoveryReply[]) {
  await page.addInitScript((queuedReplies) => {
    const settings = {
      baseUrl: 'https://fixture.example/v1',
      model: 'model-a',
      apiKeyEnv: 'FIXTURE_CHANNEL_KEY',
      proxyUrl: '',
    };
    let profiles: ProviderProfile[] = [
      { name: '主力渠道', settings, models: ['model-a', 'model-b'] },
    ];
    let calls = 0;
    window.__FLUX_TEST_BRIDGE__ = {
      available: true,
      subscribe: async () => () => {},
      loadSettings: async () => ({ ...settings, model: '' }),
      listProviderProfiles: async () => profiles,
      loadPreferences: async () => ({ font_size: 14, sidebar_width: 246, inspector_width: 294 }),
      discoverProvider: async () => {
        localStorage.setItem('fixture-discovery-calls', String(++calls));
        const reply = queuedReplies.shift();
        if (!reply) throw new Error('Unexpected model discovery request');
        if (reply.error) throw new Error(reply.error);
        return {
          models: reply.models ?? [],
          latencyMs: reply.latencyMs ?? 0,
          duplicateModels: reply.duplicateModels ?? 0,
        };
      },
      saveProviderProfiles: async (next: ProviderProfile[]) => {
        profiles = next;
      },
    } as unknown as NonNullable<typeof window.__FLUX_TEST_BRIDGE__>;
  }, replies);
  await page.goto('/');
  await page.getByRole('button', { name: '渠道管理' }).click();
  return page.getByRole('dialog', { name: '渠道管理' });
}

test('connection check reports catalogue latency without claiming inference availability', async ({
  page,
}) => {
  const dialog = await openChannel(page, [
    { models: ['model-a', 'model-b'], latencyMs: 37, duplicateModels: 1 },
  ]);
  await dialog.getByRole('button', { name: '检测连接' }).click();
  await expect(dialog.getByRole('status')).toContainText('模型目录可用 · 37 ms · 2 个模型');
  await expect(dialog.getByRole('status')).toContainText('模型推理能力以实际请求为准');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-discovery-calls')))
    .toBe('1');
});

test('failed check stays on the channel and succeeds after an explicit retry', async ({ page }) => {
  const dialog = await openChannel(page, [
    { error: '模型服务请求超时，请检查代理或稍后重试' },
    { models: ['model-a'], latencyMs: 22 },
  ]);
  await dialog.getByRole('button', { name: '检测连接' }).click();
  await expect(dialog.getByRole('alert')).toContainText('模型服务请求超时');
  await expect(dialog.getByRole('button', { name: '检测连接' })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-discovery-calls')))
    .toBe('1');
  await dialog.getByRole('button', { name: '检测连接' }).click();
  await expect(dialog.getByRole('status')).toContainText('模型目录可用 · 22 ms · 1 个模型');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-discovery-calls')))
    .toBe('2');
});

test('refresh previews model changes before applying them', async ({ page }) => {
  const dialog = await openChannel(page, [{ models: ['model-a', 'model-c'], latencyMs: 18 }]);
  await dialog.getByRole('button', { name: '刷新模型' }).click();
  await expect(dialog.getByText('新增模型 1 · 保留模型 1 · 移除模型 1')).toBeVisible();
  await expect(dialog.getByText('模型目录可用 · 18 ms · 2 个模型')).toBeVisible();
  await dialog.getByRole('button', { name: '应用模型变更' }).click();
  await expect(dialog.getByText('模型目录已更新')).toBeVisible();
  await expect(dialog.getByText('新增模型 1 · 保留模型 1 · 移除模型 1')).toHaveCount(0);
});

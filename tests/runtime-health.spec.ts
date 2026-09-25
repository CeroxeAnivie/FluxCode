import { expect, test, type Page } from '@playwright/test';

async function openFixture(page: Page, english = false) {
  await page.addInitScript((english) => {
    if (english)
      localStorage.setItem(
        'fluxcode.appearance.v1',
        JSON.stringify({ language: 'en', theme: 'light' }),
      );
    window.__FLUX_TEST_BRIDGE__ = {
      available: true,
      subscribe: async () => () => {},
      loadSettings: async () => ({
        baseUrl: 'https://example.com/v1',
        model: 'fixture-model',
        apiKeyEnv: 'TEST_KEY',
        proxyUrl: '',
      }),
      listProviderProfiles: async () => [],
      loadPreferences: async () => ({ font_size: 14, sidebar_width: 246, inspector_width: 294 }),
      connect: async () => ({ version: 'fixture' }),
      diagnostics: async () => {
        const value = localStorage.getItem('fixture-runtime-health');
        if (value === 'error') throw new Error('fixture diagnostic failure');
        return {
          schemaVersion: 1,
          runtimeHealth: JSON.parse(
            value ??
              JSON.stringify({
                git: 'ready',
                webview2: 'ready',
                engine: 'ready',
                codeModeHost: 'ready',
                legal: 'ready',
              }),
          ),
        };
      },
      exportDocument: async (name: string, content: string) => {
        localStorage.setItem('fixture-export', JSON.stringify({ name, content }));
        return true;
      },
    } as unknown as NonNullable<typeof window.__FLUX_TEST_BRIDGE__>;
  }, english);
  await page.goto('/');
  await page.getByRole('button', { name: english ? 'Settings' : '设置', exact: true }).click();
}

test('local environment shows actionable failures and keeps redacted export', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() =>
    localStorage.setItem(
      'fixture-runtime-health',
      JSON.stringify({
        git: 'missing',
        webview2: 'ready',
        engine: 'corrupt',
        codeModeHost: 'ready',
        legal: 'unreadable',
      }),
    ),
  );
  const dialog = page.getByRole('dialog', { name: '工作空间设置' });
  await dialog.locator('.runtime-health-settings summary').click();
  const rows = dialog.locator('.runtime-health-list li');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('版本控制工具');
  await expect(rows.nth(0)).toContainText('未找到');
  await expect(rows.nth(0).getByRole('button', { name: '打开官方下载页' })).toBeVisible();
  await expect(rows.nth(2)).toContainText('使用当前版本的安装包修复程序');
  await expect(rows.nth(2).getByRole('button')).toHaveCount(0);
  await dialog.getByRole('button', { name: '导出脱敏诊断' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-export')))
    .not.toBeNull();
  const exported = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-export')!));
  expect(exported.name).toBe('FluxCode-diagnostics.json');
  expect(JSON.parse(exported.content).runtimeHealth.engine).toBe('corrupt');
});

test('English runtime health and retry errors remain localized', async ({ page }) => {
  await openFixture(page, true);
  const dialog = page.getByRole('dialog', { name: 'Workspace settings' });
  await dialog.locator('.runtime-health-settings summary').click();
  const list = dialog.locator('.runtime-health-settings');
  await expect(list.getByText('Bundled execution engine')).toBeVisible();
  await expect(list.getByText('Ready')).toHaveCount(5);
  await page.evaluate(() => localStorage.setItem('fixture-runtime-health', 'error'));
  await list.getByRole('button', { name: 'Check again' }).click();
  await expect(list.getByRole('alert')).toHaveText(
    'The local environment check failed. Try again.',
  );
  expect(await list.innerText()).not.toMatch(/[\u3400-\u9fff]/);
});

import { expect, test, type Page } from '@playwright/test';

async function openFixture(page: Page, language: 'zh-CN' | 'en' = 'zh-CN') {
  await page.addInitScript((language) => {
    if (language === 'en') {
      localStorage.setItem('fluxcode.appearance.v1', JSON.stringify({ language, theme: 'system' }));
    }
    const settings = {
      baseUrl: 'https://example.com/v1',
      model: 'fixture-model',
      apiKeyEnv: 'TEST_KEY',
      proxyUrl: '',
    };
    window.__FLUX_TEST_BRIDGE__ = {
      available: true,
      subscribe: async () => () => {},
      loadSettings: async () => settings,
      listProviderProfiles: async () => [],
      loadPreferences: async () => ({ font_size: 14, sidebar_width: 246, inspector_width: 294 }),
      connect: async () => ({ version: 'fixture' }),
      chooseAttachments: async () => JSON.parse(localStorage.getItem('fixture-picks') ?? '[]'),
      inspectDroppedPaths: async (paths: string[]) => {
        localStorage.setItem('fixture-inspected', JSON.stringify(paths));
        if (paths.length > 20) throw new Error('每次最多拖入 20 个文件或目录');
        if (paths.some((path) => path.endsWith('too-large.bin')))
          throw new Error('拖入的文件超过大小上限：图片 20 MiB，其他文件 50 MiB');
        if (paths.some((path) => path.endsWith('unreadable.txt')))
          throw new Error('无法读取拖入的文件或目录');
        if (paths.some((path) => path.endsWith('shortcut.lnk')))
          throw new Error('不支持拖入链接文件或目录');
        return paths.map((path) => ({
          path,
          kind: /\.(png|jpe?g|webp|gif)$/i.test(path) ? 'image' : 'file',
        }));
      },
      previewAttachment: async (path: string) => {
        localStorage.setItem('fixture-previewed', path);
        if (path.endsWith('bad.png')) throw new Error('无法预览此图片');
        if (path.endsWith('remote.png')) return 'https://example.invalid/remote-image.png';
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9PihEAAAAASUVORK5CYII=';
      },
    } as unknown as NonNullable<typeof window.__FLUX_TEST_BRIDGE__>;
  }, language);
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /添加文件或图片|Attach files or images/ }),
  ).toBeVisible();
}

async function pick(page: Page, paths: string[]) {
  await page.evaluate(
    (items) => localStorage.setItem('fixture-picks', JSON.stringify(items)),
    paths,
  );
  await page.getByRole('button', { name: /添加文件或图片|Attach files or images/ }).click();
}

test('image attachment previews on demand, closes with Escape, and can be removed', async ({
  page,
}) => {
  await openFixture(page);
  await pick(page, ['C:/work/design.png']);
  await expect(page.locator('.attachment-feedback')).toHaveText('已添加 1 个附件');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fixture-inspected') ?? '[]')))
    .toEqual(['C:/work/design.png']);
  const preview = page.getByRole('button', { name: '预览图片 design.png' });
  await preview.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '预览图片 design.png' });
  await expect(dialog.getByRole('img', { name: 'design.png' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fixture-previewed'))).toBe(
    'C:/work/design.png',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(preview).toBeFocused();
  await page.getByRole('button', { name: '移除 design.png' }).click();
  await expect(preview).toHaveCount(0);
});

test('duplicate Windows paths are skipped with visible feedback', async ({ page }) => {
  await openFixture(page);
  await pick(page, ['C:/work/spec.txt']);
  await pick(page, ['c:\\WORK\\spec.txt', 'C:/work/notes.txt']);
  await expect(page.locator('.attachment-feedback')).toHaveText(
    '已添加 1 个附件 · 已跳过 1 个重复项',
  );
  await expect(page.locator('.attachment-item')).toHaveCount(2);
  await pick(page, ['C:/WORK/SPEC.TXT']);
  await expect(page.locator('.attachment-feedback')).toHaveText('已跳过 1 个重复项');
  await expect(page.locator('.attachment-item')).toHaveCount(2);
});

test('unreadable, oversized, unsupported and excessive batches fail without losing attachments', async ({
  page,
}) => {
  await openFixture(page);
  await pick(page, ['C:/work/keep.txt']);
  for (const [path, expected] of [
    ['C:/work/unreadable.txt', '无法读取拖入的文件或目录'],
    ['C:/work/too-large.bin', '超过大小上限'],
    ['C:/work/shortcut.lnk', '不支持拖入链接文件或目录'],
  ]) {
    await pick(page, [path]);
    await expect(page.getByRole('alert').first()).toContainText(expected);
    await expect(page.locator('.attachment-item')).toHaveCount(1);
  }
  await pick(
    page,
    Array.from({ length: 21 }, (_, index) => `C:/work/file-${index}.txt`),
  );
  await expect(page.getByRole('alert').first()).toContainText('每次最多拖入 20 个文件或目录');
  await expect(page.locator('.attachment-item')).toHaveCount(1);
});

test('image preview failure explains the error without losing the attachment', async ({ page }) => {
  await openFixture(page);
  await pick(page, ['C:/work/bad.png']);
  const preview = page.getByRole('button', { name: '预览图片 bad.png' });
  await preview.click();
  const dialog = page.getByRole('dialog', { name: '预览图片 bad.png' });
  await expect(dialog.getByRole('alert')).toContainText('无法预览此图片');
  await dialog.getByRole('button', { name: '关闭图片预览' }).click();
  await expect(preview).toBeFocused();
  await expect(page.locator('.attachment-item')).toHaveCount(1);
});

test('English preview failures stay localized and reject remote image URLs', async ({ page }) => {
  await openFixture(page, 'en');
  await pick(page, ['C:/work/remote.png']);
  await expect(page.locator('.attachment-feedback')).toHaveText('1 attachment added');
  await page.getByRole('button', { name: 'Preview image remote.png' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview image remote.png' });
  await expect(dialog.getByRole('alert')).toContainText(
    'The image could not be previewed. Check the file and try again.',
  );
  await expect(dialog.getByRole('alert')).toContainText('The image preview data is invalid.');
  await expect(dialog.getByRole('img')).toHaveCount(0);
});

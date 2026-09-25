import { expect, test, type Page } from '@playwright/test';
import type { GitAction } from '../src/domain/git';

type Fixture = {
  path: string;
  status: string;
  working: string;
  staged?: string;
  language?: 'en';
};

async function openFixture(page: Page, fixture: Fixture) {
  await page.addInitScript(({ path, status, working, staged, language }) => {
    if (language) {
      localStorage.setItem('fluxcode.appearance.v1', JSON.stringify({ language, theme: 'system' }));
    }
    localStorage.setItem(
      'fluxcode.catalog.v1',
      JSON.stringify({
        version: 1,
        projects: [{ id: 'project', name: 'Sample', path: 'C:/Sample' }],
        tasks: [],
      }),
    );
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
      listFiles: async (_root: string, relative: string) =>
        path.endsWith('/')
          ? relative === path.slice(0, -1)
            ? [{ name: 'new.ts', path: `${path}new.ts`, directory: false }]
            : [{ name: path.slice(0, -1), path: path.slice(0, -1), directory: true }]
          : [{ name: path, path, directory: false }],
      readFile: async () => 'file content',
      repoStatus: async () => ({ branch: 'main', git: true, changes: [{ path, status }] }),
      gitBranches: async () => ({ current: 'main', branches: ['main'] }),
      gitOperation: async () => ({ kind: null, conflicts: [], dirty: false }),
      listCheckpoints: async () => [],
      fileDiff: async (_root: string, _path: string, isStaged: boolean) =>
        isStaged ? (staged ?? '') : working,
      gitAction: async (_root: string, action: GitAction) => {
        localStorage.setItem('fixture-last-git-action', JSON.stringify(action));
        return '';
      },
      searchWorkspace: async () => ({ hits: [], truncated: false }),
    } as unknown as NonNullable<typeof window.__FLUX_TEST_BRIDGE__>;
  }, fixture);
  await page.goto('/');
  const changes = page.getByRole('button', {
    name: fixture.language === 'en' ? 'Changes' : '变更',
    exact: false,
  });
  await expect(changes.first()).toBeVisible();
  await changes.first().click();
}

test('keyboard preview returns to its change row after a diff action refresh', async ({ page }) => {
  const path = 'src/main.ts';
  await openFixture(page, {
    path,
    status: ' M',
    working:
      'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n',
  });
  const row = page.getByRole('button', { name: `修改 ${path}` });
  await row.focus();
  await page.keyboard.press('Enter');
  const back = page.getByRole('button', { name: '返回文件列表' });
  await expect(back).toBeFocused();
  await page.getByRole('button', { name: '暂存此差异块' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('fixture-last-git-action') ?? '{}').type),
    )
    .toBe('hunk');
  await back.click();
  await expect(row).toBeFocused();
});

test('staged rename offers only unstage and explains file-level handling', async ({ page }) => {
  const path = 'src/new-name.ts';
  await openFixture(page, {
    path,
    status: 'R ',
    working: '',
    staged:
      'diff --git a/src/old-name.ts b/src/new-name.ts\nsimilarity index 80%\nrename from src/old-name.ts\nrename to src/new-name.ts\n--- a/src/old-name.ts\n+++ b/src/new-name.ts\n@@ -1 +1 @@\n-old\n+new\n',
  });
  const actions = page.getByRole('group', { name: `重命名 ${path}` });
  await expect(actions.getByRole('button', { name: `取消暂存 ${path}` })).toBeVisible();
  await expect(actions.getByRole('button', { name: `暂存 ${path}`, exact: true })).toHaveCount(0);
  const row = page.getByRole('button', { name: `重命名 ${path}` });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('新增、删除、重命名、二进制或权限变更请使用文件级暂存。'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '取消暂存此差异块' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /选择要取消暂存的差异行/ })).toHaveCount(0);
  await page.getByRole('button', { name: '返回文件列表' }).click();
  await expect(row).toBeFocused();
});

test('permission changes with text hunks still require file-level staging', async ({ page }) => {
  await openFixture(page, {
    path: 'script.sh',
    status: ' M',
    working:
      'diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n--- a/script.sh\n+++ b/script.sh\n@@ -1 +1 @@\n-old\n+new\n',
  });
  await page.getByRole('button', { name: '修改 script.sh' }).click();
  await expect(
    page.getByText('新增、删除、重命名、二进制或权限变更请使用文件级暂存。'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '暂存此差异块' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /选择要暂存的差异行/ })).toHaveCount(0);
});

test('deleted file has a usable status and no stale reference action', async ({ page }) => {
  const path = 'src/removed.ts';
  await openFixture(page, {
    path,
    status: ' D',
    working:
      'diff --git a/src/removed.ts b/src/removed.ts\ndeleted file mode 100644\n--- a/src/removed.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n',
  });
  await expect(page.getByRole('group', { name: `删除 ${path}` })).toBeVisible();
  await page.getByRole('button', { name: `删除 ${path}` }).click();
  await expect(page.getByRole('button', { name: '引用到对话' })).toHaveCount(0);
  await expect(
    page.getByText('新增、删除、重命名、二进制或权限变更请使用文件级暂存。'),
  ).toBeVisible();
});

test('new files and binary changes expose whole-file actions', async ({ page }) => {
  await openFixture(page, {
    path: 'assets/logo.png',
    status: ' M',
    working:
      'diff --git a/assets/logo.png b/assets/logo.png\nindex 1234567..abcdef0 100644\nBinary files a/assets/logo.png and b/assets/logo.png differ\n',
  });
  const actions = page.getByRole('group', { name: '修改 assets/logo.png' });
  await expect(actions.getByRole('button', { name: '暂存 assets/logo.png' })).toBeVisible();
  await page.getByRole('button', { name: '修改 assets/logo.png' }).click();
  await expect(
    page.getByText('新增、删除、重命名、二进制或权限变更请使用文件级暂存。'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '暂存此差异块' })).toHaveCount(0);
});

test('untracked directory opens its files and keeps the whole-directory stage action', async ({
  page,
}) => {
  await openFixture(page, { path: 'new/', status: '??', working: '' });
  await expect(page.getByRole('group', { name: '未跟踪 new/' })).toBeVisible();
  await expect(page.getByRole('button', { name: '暂存 new/' })).toBeVisible();
  await page.getByRole('button', { name: '未跟踪 new/' }).click();
  await expect(page.getByRole('button', { name: 'new.ts' })).toBeVisible();
  await expect(page.getByRole('button', { name: '文件', exact: true })).toBeFocused();
});

test('English change labels and file-level guidance remain translated', async ({ page }) => {
  await openFixture(page, {
    path: 'src/added.ts',
    status: 'A ',
    language: 'en',
    working: '',
    staged:
      'diff --git a/src/added.ts b/src/added.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/added.ts\n@@ -0,0 +1 @@\n+new\n',
  });
  const actions = page.getByRole('group', { name: 'Added src/added.ts' });
  await expect(actions.getByRole('button', { name: 'Unstage src/added.ts' })).toBeVisible();
  await expect(
    actions.getByRole('button', { name: 'Stage src/added.ts', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Added src/added.ts' }).click();
  await expect(
    page.getByText(
      'Stage additions, deletions, renames, binary files and mode changes as whole files.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unstage this hunk' })).toHaveCount(0);
});

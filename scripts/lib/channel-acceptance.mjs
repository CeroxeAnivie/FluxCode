import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

/** Runs against the real Windows host and a caller-owned local model catalogue. */
export async function verifyNativeChannels(page, data, setModels) {
  const invoke = (command, args = {}) =>
    page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
      command,
      args,
    });
  const original = await invoke('list_provider_profiles');
  const connection = await invoke('load_settings');
  const file = resolve(data, 'providers.toml');
  let readonly = false;
  const setReadonly = (enabled) => {
    const result = spawnSync('attrib.exe', [enabled ? '+R' : '-R', file], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    readonly = enabled;
  };
  const profile = (name, suffix) => ({
    ...original[0],
    name,
    settings: { ...original[0].settings, apiKeyEnv: `FLUX_NATIVE_${suffix}` },
    models: ['native-fixture', 'legacy-fixture'],
  });
  const card = (name) =>
    page.locator('.channel-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const openImport = async (rows) => {
    await page.getByRole('button', { name: '批量导入渠道', exact: true }).click();
    await page
      .getByLabel('渠道 TOML', { exact: true })
      .fill(await invoke('encode_provider_profiles', { profiles: rows }));
    await page.getByRole('button', { name: '预览导入', exact: true }).click();
    await expect(page.getByRole('button', { name: '导入全部渠道', exact: true })).toBeVisible();
  };
  try {
    await openImport([profile('原生批量甲', 'A'), profile('原生批量乙', 'B')]);
    await expect(page.locator('.import-preview li')).toHaveCount(2);
    await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
    await expect(page.locator('.channel-card')).toHaveCount(original.length + 2);

    await card('原生批量甲').getByRole('button', { name: '复制渠道配置', exact: true }).click();
    await page.getByLabel('访问密钥', { exact: true }).fill('native-channel-copy-fixture');
    await page.getByRole('button', { name: '仅保存', exact: true }).click();
    await expect(page.locator('.channel-card')).toHaveCount(original.length + 3);
    const copied = (await invoke('list_provider_profiles')).find((row) =>
      row.name.includes('副本'),
    );
    assert.ok(copied);
    assert.notEqual(copied.settings.apiKeyEnv, 'FLUX_NATIVE_A');
    assert.ok(!(await readFile(file, 'utf8')).includes('native-channel-copy-fixture'));

    await card('原生批量乙').getByRole('button', { name: '检测连接', exact: true }).click();
    await expect(card('原生批量乙')).toContainText('模型目录可用');
    await expect(card('原生批量乙')).toContainText('仅检测目录访问');
    setModels(['native-fixture', 'refresh-added']);
    await card('原生批量乙').getByRole('button', { name: '刷新模型', exact: true }).click();
    await expect(card('原生批量乙').locator('.model-refresh-preview')).toContainText('新增模型 1');
    await expect(card('原生批量乙').locator('.model-refresh-preview')).toContainText('移除模型 1');
    await card('原生批量乙').getByRole('button', { name: '应用模型变更', exact: true }).click();
    await expect(card('原生批量乙')).toContainText('模型目录已更新');
    assert.deepEqual(
      (await invoke('list_provider_profiles')).find((row) => row.name === '原生批量乙').models,
      ['native-fixture', 'refresh-added'],
    );

    setModels(['native-fixture', 'after-retry']);
    await card('原生批量乙').getByRole('button', { name: '刷新模型', exact: true }).click();
    const beforeFailure = await readFile(file, 'utf8');
    setReadonly(true);
    await card('原生批量乙').getByRole('button', { name: '应用模型变更', exact: true }).click();
    await expect(card('原生批量乙').getByRole('alert')).toBeVisible();
    assert.equal(await readFile(file, 'utf8'), beforeFailure);
    assert.deepEqual(await invoke('load_settings'), connection);
    await expect(card('原生批量乙').locator('.model-refresh-preview')).toBeVisible();
    setReadonly(false);
    await card('原生批量乙').getByRole('button', { name: '应用模型变更', exact: true }).click();
    await expect(card('原生批量乙')).toContainText('模型目录已更新');

    await openImport([profile('原生并发导入', 'PENDING')]);
    const beforeConcurrent = await invoke('list_provider_profiles');
    await invoke('save_provider_profiles', {
      profiles: [...beforeConcurrent, profile('外部新增渠道', 'EXTERNAL')],
      expectedProfiles: beforeConcurrent,
    });
    await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
    await expect(page.locator('.channel-transfer').getByRole('alert')).toBeVisible();
    assert.ok((await invoke('list_provider_profiles')).some((row) => row.name === '外部新增渠道'));
    assert.ok(!(await invoke('list_provider_profiles')).some((row) => row.name === '原生并发导入'));
    await expect(page.getByRole('textbox', { name: '渠道 TOML', exact: true })).not.toHaveValue('');
    await page.getByRole('button', { name: '重新载入渠道', exact: true }).click();
    await expect(card('外部新增渠道')).toBeVisible();
    await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
    await expect(card('原生并发导入')).toBeVisible();
    assert.deepEqual(await invoke('load_settings'), connection);
    console.log(
      'PASS: native channel bulk import, independent copy, discovery, model diff, read-only rollback/retry and concurrent-write rejection/recovery',
    );
  } finally {
    if (readonly) setReadonly(false);
    setModels(['native-fixture']);
    const current = await invoke('list_provider_profiles');
    for (const row of current.filter((row) => !original.some((old) => old.name === row.name))) {
      await invoke('forget_api_key', { settings: row.settings });
    }
    await invoke('save_provider_profiles', { profiles: original, expectedProfiles: current });
    await page.getByRole('button', { name: '重新载入渠道', exact: true }).click();
    await expect(page.locator('.channel-card')).toHaveCount(original.length);
  }
}

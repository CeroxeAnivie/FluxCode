import { expect, it } from 'vitest';
import {
  compareProviderModels,
  mergeProviderProfiles,
  providerModels,
  sameConnection,
  sameProvider,
} from './provider';
import { defaultSettings, validateSettings } from './types';
it('uses host networking by default and validates an explicitly configured proxy', () => {
  const settings = { ...defaultSettings, model: 'fixture' };
  expect(settings.proxyUrl).toBe('');
  expect(validateSettings(settings)).toBeNull();
  expect(validateSettings({ ...settings, proxyUrl: 'https://proxy.example:8443/' })).toBeNull();
  expect(
    validateSettings({ ...settings, proxyUrl: 'https://user:secret@proxy.example/' }),
  ).toBeTruthy();
  expect(validateSettings({ ...settings, proxyUrl: 'invalid' })).toBeTruthy();
});
it('keeps the complete catalogue and supports legacy single-model profiles', () => {
  const models = Array.from({ length: 500 }, (_, i) => `model-${i}`);
  expect(
    providerModels({ name: 'all', settings: { ...defaultSettings, model: models[0] }, models }),
  ).toEqual(models);
  expect(
    providerModels({ name: 'legacy', settings: { ...defaultSettings, model: 'legacy-model' } }),
  ).toEqual(['legacy-model']);
});
it('separates accounts on the same service and normalizes a trailing slash', () => {
  expect(
    sameProvider(defaultSettings, { ...defaultSettings, baseUrl: defaultSettings.baseUrl + '/' }),
  ).toBe(true);
  expect(sameProvider(defaultSettings, { ...defaultSettings, apiKeyEnv: 'SECOND_ACCOUNT' })).toBe(
    false,
  );
  expect(
    sameConnection(defaultSettings, { ...defaultSettings, proxyUrl: 'http://other-proxy/' }),
  ).toBe(false);
});
it('imports duplicate names without replacing existing channels or dropping model catalogues', () => {
  const current = [{ name: 'Primary', settings: defaultSettings, models: ['one'] }];
  const incoming = [
    { name: 'Primary', settings: { ...defaultSettings, apiKeyEnv: 'SECOND' }, models: ['two'] },
    { name: 'Primary', settings: { ...defaultSettings, apiKeyEnv: 'THIRD' }, models: ['three'] },
  ];
  const merged = mergeProviderProfiles(current, incoming);
  expect(merged.profiles.map((row) => row.name)).toEqual(['Primary', 'Primary (2)', 'Primary (3)']);
  expect(merged.profiles[0]).toBe(current[0]);
  expect(merged.added.map((row) => row.models)).toEqual([['two'], ['three']]);
  expect(merged.renamed).toBe(2);
  expect(merged.isolatedCredentials).toBe(0);
});
it('isolates credential identities when imported channels share an address and key ID', () => {
  const current = [{ name: 'Primary', settings: defaultSettings, models: ['one'] }];
  const incoming = [
    { name: 'Other', settings: { ...defaultSettings, baseUrl: `${defaultSettings.baseUrl}/` } },
    { name: 'Third', settings: defaultSettings },
  ];
  let next = 0;
  const merged = mergeProviderProfiles(current, incoming, 'rename', () => `IMPORTED_${++next}`);
  expect(merged.isolatedCredentials).toBe(2);
  expect(merged.added.map((profile) => profile.settings.apiKeyEnv)).toEqual([
    'IMPORTED_1',
    'IMPORTED_2',
  ]);
  expect(current[0].settings.apiKeyEnv).toBe(defaultSettings.apiKeyEnv);
  expect(incoming[0].settings.apiKeyEnv).toBe(defaultSettings.apiKeyEnv);
  expect(
    merged.profiles.every(
      (row, index, rows) =>
        rows.findIndex((other) => sameProvider(row.settings, other.settings)) === index,
    ),
  ).toBe(true);
});
it('previews skip and replace policies without mutating existing profiles', () => {
  const current = [{ name: 'Primary', settings: defaultSettings, models: ['old'] }];
  const incoming = [
    { name: 'Primary', settings: { ...defaultSettings, model: 'new' }, models: ['new'] },
    { name: 'Backup', settings: { ...defaultSettings, apiKeyEnv: 'BACKUP_KEY' }, models: ['b'] },
  ];
  const skipped = mergeProviderProfiles(current, incoming, 'skip');
  expect(skipped.skipped).toBe(1);
  expect(skipped.profiles.map((row) => row.name)).toEqual(['Primary', 'Backup']);
  expect(skipped.profiles[0]).toBe(current[0]);
  const replaced = mergeProviderProfiles(current, incoming, 'replace');
  expect(replaced.replaced).toBe(1);
  expect(replaced.profiles.map((row) => row.name)).toEqual(['Primary', 'Backup']);
  expect(replaced.profiles[0].models).toEqual(['new']);
  expect(current[0].models).toEqual(['old']);
});
it('compares refreshed models without changing the source lists', () => {
  const before = ['a', 'b'];
  const after = ['b', 'c'];
  expect(compareProviderModels(before, after)).toEqual({
    added: ['c'],
    removed: ['a'],
    retained: ['b'],
  });
  expect(before).toEqual(['a', 'b']);
  expect(after).toEqual(['b', 'c']);
});

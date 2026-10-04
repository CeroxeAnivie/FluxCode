import type { Settings } from './types';
export interface ProviderProfile {
  name: string;
  settings: Settings;
  models?: string[];
  model_labels?: Record<string, string>;
  excluded_models?: string[];
}
export function sameProvider(a: Settings, b: Settings): boolean {
  return (
    a.baseUrl.trim().replace(/\/+$/, '') === b.baseUrl.trim().replace(/\/+$/, '') &&
    a.apiKeyEnv === b.apiKeyEnv
  );
}
export function sameConnection(a: Settings, b: Settings): boolean {
  return sameProvider(a, b) && a.proxyUrl.trim() === b.proxyUrl.trim();
}
export function providerModels(profile: ProviderProfile): string[] {
  const excluded = new Set(profile.excluded_models ?? []);
  return [
    ...new Set(
      (profile.models?.length ? profile.models : [profile.settings.model]).filter(Boolean),
    ),
  ].filter((id) => !excluded.has(id));
}
export function providerModelLabel(profile: ProviderProfile, id: string): string {
  return profile.model_labels?.[id]?.trim() || id;
}
export function providerModelEntries(profile: ProviderProfile): { id: string; label: string }[] {
  return providerModels(profile).map((id) => ({ id, label: providerModelLabel(profile, id) }));
}
export function providerModelLabels(profile: ProviderProfile): Record<string, string> {
  return Object.fromEntries(
    providerModels(profile).map((id) => [id, providerModelLabel(profile, id)]),
  );
}
export interface ProviderDiscovery {
  models: string[];
  latencyMs: number;
  duplicateModels?: number;
}

export type ImportConflictStrategy = 'rename' | 'skip' | 'replace';

export function mergeProviderProfiles(
  current: ProviderProfile[],
  incoming: ProviderProfile[],
  strategy: ImportConflictStrategy = 'rename',
  credentialId: () => string = () =>
    `FLUXCODE_CHANNEL_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`,
) {
  const profiles = [...current];
  const changes: ProviderProfile[] = [];
  let renamed = 0;
  let skipped = 0;
  let replaced = 0;
  let isolatedCredentials = 0;
  for (const profile of incoming) {
    let name = profile.name;
    const existingIndex = profiles.findIndex((row) => row.name === name);
    if (existingIndex >= 0 && strategy === 'skip') {
      skipped++;
      continue;
    }
    if (existingIndex >= 0 && strategy === 'rename') {
      let suffix = 2;
      while (profiles.some((row) => row.name === name)) {
        const label = ` (${suffix++})`;
        name = `${Array.from(profile.name)
          .slice(0, 120 - label.length)
          .join('')}${label}`;
      }
      renamed++;
    }
    let settings = profile.settings;
    const otherProfiles = profiles.filter(
      (_, index) => index !== (strategy === 'replace' ? existingIndex : -1),
    );
    if (otherProfiles.some((row) => sameProvider(row.settings, settings))) {
      let apiKeyEnv = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = credentialId();
        if (
          !otherProfiles.some((row) =>
            sameProvider(row.settings, { ...settings, apiKeyEnv: candidate }),
          )
        ) {
          apiKeyEnv = candidate;
          break;
        }
      }
      if (!apiKeyEnv) throw new Error('无法为导入渠道分配独立凭据标识。');
      settings = { ...settings, apiKeyEnv };
      isolatedCredentials++;
    }
    const result = { ...profile, name, settings };
    changes.push(result);
    if (existingIndex >= 0 && strategy === 'replace') {
      profiles[existingIndex] = result;
      replaced++;
    } else {
      profiles.push(result);
    }
  }
  return { added: changes, profiles, renamed, skipped, replaced, isolatedCredentials };
}

export function compareProviderModels(before: string[], after: string[]) {
  const oldSet = new Set(before);
  const newSet = new Set(after);
  return {
    added: after.filter((id) => !oldSet.has(id)),
    removed: before.filter((id) => !newSet.has(id)),
    retained: after.filter((id) => oldSet.has(id)),
  };
}

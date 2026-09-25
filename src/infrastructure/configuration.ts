import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Appearance } from '../domain/appearance';
import type { Settings } from '../domain/types';

export interface ConfigurationSnapshot {
  revision: number;
  settingsRevision: number;
  settings: Settings;
  ui: { font_size: number; sidebar_width: number; inspector_width: number };
  appearance: Appearance;
  appearanceConfigured: boolean;
  error: string | null;
  watching: boolean;
}

export const configuration = {
  native: isTauri(),
  load: () => invoke<ConfigurationSnapshot>('configuration_snapshot'),
  idle: () => invoke<boolean>('configuration_runtime_idle'),
  saveAppearance: (appearance: Appearance, migrate = false) =>
    invoke<ConfigurationSnapshot>('save_appearance', { appearance, migrate }),
  subscribe: (handler: (value: ConfigurationSnapshot) => void) =>
    listen<ConfigurationSnapshot>('configuration-changed', (event) => handler(event.payload)),
};

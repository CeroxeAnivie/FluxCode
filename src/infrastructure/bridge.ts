import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { Entry, RepoStatus, RpcEvent, Settings } from '../domain/types';
import { defaultSettings } from '../domain/types';

export interface Bridge {
  available: boolean;
  loadSettings(): Promise<Settings>;
  connect(settings: Settings, apiKey?: string, rememberKey?: boolean): Promise<{ version: string }>;
  forgetApiKey(settings: Settings): Promise<void>;
  openUserFile(kind: 'config' | 'agent' | 'environment'): Promise<void>;
  rpc<T>(method: string, params: object): Promise<T>;
  subscribe(handler: (event: RpcEvent) => void): Promise<() => void>;
  chooseDirectory(): Promise<string | null>;
  listFiles(root: string, relative: string): Promise<Entry[]>;
  readFile(root: string, relative: string): Promise<string>;
  repoStatus(root: string): Promise<RepoStatus>;
  fileDiff(root: string, relative: string, staged: boolean): Promise<string>;
  executeTerminal(
    cwd: string,
    command: string,
    processId: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  loadPreferences(): Promise<{ font_size: number; sidebar_width: number; inspector_width: number }>;
  saveFontSize(size: number): Promise<void>;
}

const unavailable = () =>
  Promise.reject(new Error('请使用 FluxCode 桌面应用；浏览器预览无法访问本地执行引擎。'));

const desktop: Bridge = {
  available: isTauri(),
  loadSettings: () => (isTauri() ? invoke('load_settings') : Promise.resolve(defaultSettings)),
  connect: (settings, apiKey, rememberKey = false) =>
    isTauri()
      ? invoke('connect_engine', { settings, apiKey: apiKey || null, rememberKey })
      : unavailable(),
  forgetApiKey: (settings) => invoke('forget_api_key', { settings }),
  openUserFile: (kind) => invoke('open_user_file', { kind }),
  rpc: (method, params) => (isTauri() ? invoke('engine_rpc', { method, params }) : unavailable()),
  subscribe: async (handler) =>
    isTauri() ? listen<RpcEvent>('engine-event', (e) => handler(e.payload)) : () => {},
  chooseDirectory: async () =>
    isTauri()
      ? ((await open({ directory: true, multiple: false, title: '打开项目' })) as string | null)
      : unavailable(),
  listFiles: (root, relative) => invoke('list_files', { root, relative }),
  readFile: (root, relative) => invoke('read_file', { root, relative }),
  repoStatus: (root) => invoke('repo_status', { root }),
  fileDiff: (root, relative, staged) => invoke('file_diff', { root, relative, staged }),
  executeTerminal: (cwd, command, processId) =>
    invoke('execute_terminal', { cwd, command, processId }),
  loadPreferences: () =>
    isTauri()
      ? invoke('load_preferences')
      : Promise.resolve({ font_size: 14, sidebar_width: 246, inspector_width: 294 }),
  saveFontSize: (size) => invoke('save_font_size', { size }),
};

// An explicit test build can inject a transport. Production never reads this global.
declare global {
  interface Window {
    __FLUX_TEST_BRIDGE__?: Bridge;
  }
}
export const bridge: Bridge =
  import.meta.env.MODE === 'test' && window.__FLUX_TEST_BRIDGE__
    ? window.__FLUX_TEST_BRIDGE__
    : desktop;

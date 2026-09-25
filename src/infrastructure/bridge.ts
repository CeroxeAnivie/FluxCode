import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { Entry, RepoStatus, RpcEvent, Settings } from '../domain/types';
import { defaultSettings } from '../domain/types';
import { nativeDialogText } from '../domain/nativeDialog';
import type {
  GitAction,
  GitBranches,
  GitOperation,
  ConflictVersions,
  Checkpoint,
} from '../domain/git';
import type { Schedule } from '../domain/schedules';
import type { ProviderProfile, ProviderDiscovery } from '../domain/provider';
import type { McpDefinition } from '../domain/extensions';

export interface Bridge {
  available: boolean;
  inspectDroppedPaths(
    paths: string[],
  ): Promise<{ path: string; kind: 'file' | 'directory' | 'image' }[]>;
  previewAttachment(path: string): Promise<string>;
  openWorkspaceFile(root: string, relative: string): Promise<void>;
  searchWorkspace(
    root: string,
    query: string,
    contents: boolean,
  ): Promise<{ hits: { path: string; line: number; preview: string }[]; truncated: boolean }>;
  answerElicitation(id: string | number, result: Record<string, unknown>): Promise<void>;
  listSchedules(): Promise<Schedule[]>;
  saveSchedule(job: Schedule): Promise<void>;
  removeSchedule(id: string): Promise<void>;
  diagnostics(): Promise<Record<string, unknown>>;
  installSkill(source: string): Promise<string>;
  exportDocument(name: string, content: string): Promise<boolean>;
  readDocument(extensions: string[]): Promise<string | null>;
  decodeProviderProfiles(text: string): Promise<ProviderProfile[]>;
  encodeProviderProfiles(profiles: ProviderProfile[]): Promise<string>;
  listProviderProfiles(): Promise<ProviderProfile[]>;
  saveProviderProfile(
    profile: ProviderProfile,
    previousName: string | null,
    expectedProfiles: ProviderProfile[],
    apiKey?: string,
  ): Promise<ProviderProfile[]>;
  saveProviderProfiles(
    profiles: ProviderProfile[],
    expectedProfiles?: ProviderProfile[],
  ): Promise<void>;
  discoverProvider(settings: Settings, apiKey?: string): Promise<ProviderDiscovery>;
  loadSettings(): Promise<Settings>;
  connect(
    settings: Settings,
    apiKey?: string,
    rememberKey?: boolean,
    expectedRevision?: number,
    forceReconnect?: boolean,
  ): Promise<{ version: string }>;
  forgetApiKey(settings: Settings): Promise<void>;
  openUserFile(kind: 'config' | 'agent' | 'environment'): Promise<void>;
  rpc<T>(method: string, params: object): Promise<T>;
  subscribe(handler: (event: RpcEvent) => void): Promise<() => void>;
  chooseDirectory(): Promise<string | null>;
  chooseAttachments(): Promise<string[]>;
  listFiles(root: string, relative: string): Promise<Entry[]>;
  readFile(root: string, relative: string): Promise<string>;
  saveFile(root: string, relative: string, expected: string, content: string): Promise<void>;
  repoStatus(root: string): Promise<RepoStatus>;
  gitAction(root: string, action: GitAction): Promise<string>;
  gitBranches(root: string): Promise<GitBranches>;
  gitOperation(root: string): Promise<GitOperation>;
  gitConflictVersions(root: string, path: string): Promise<ConflictVersions>;
  listCheckpoints(root: string): Promise<Checkpoint[]>;
  listMcpDefinitions(): Promise<McpDefinition[]>;
  saveMcpDefinition(definition: McpDefinition): Promise<void>;
  fileDiff(root: string, relative: string, staged: boolean): Promise<string>;
  executeTerminal(
    cwd: string,
    command: string,
    processId: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  loadPreferences(): Promise<{ font_size: number; sidebar_width: number; inspector_width: number }>;
  saveFontSize(size: number): Promise<void>;
  savePanelWidth(panel: 'sidebar' | 'inspector', width: number): Promise<void>;
  openTerminal(
    cwd: string,
    processId: string,
    rows: number,
    cols: number,
  ): Promise<{ exitCode: number }>;
  answerAgent(id: string | number, answers: Record<string, { answers: string[] }>): Promise<void>;
}

const unavailable = () =>
  Promise.reject(new Error('请使用 FluxCode 桌面应用；浏览器预览无法访问本地执行引擎。'));

const desktop: Bridge = {
  available: isTauri(),
  inspectDroppedPaths: (paths) => invoke('inspect_dropped_paths', { paths }),
  previewAttachment: (path) => invoke('preview_attachment', { path }),
  openWorkspaceFile: (root, relative) => invoke('open_workspace_file', { root, relative }),
  searchWorkspace: (root, query, contents) => invoke('search_workspace', { root, query, contents }),
  answerElicitation: (id, result) => invoke('answer_elicitation', { id, result }),
  listSchedules: () => invoke('list_schedules'),
  saveSchedule: (job) => invoke('save_schedule', { job }),
  removeSchedule: (id) => invoke('remove_schedule', { id }),
  diagnostics: () => invoke('diagnostics'),
  installSkill: (source) => invoke('install_skill', { source }),
  exportDocument: async (name, content) => {
    const labels = nativeDialogText(document.documentElement.lang);
    const path = await save({
      title: labels.exportDocument,
      defaultPath: name,
      filters: [{ name: labels.documents, extensions: [name.split('.').at(-1) ?? 'txt'] }],
    });
    if (!path) return false;
    await invoke('export_document', { path, content });
    return true;
  },
  readDocument: async (extensions) => {
    const labels = nativeDialogText(document.documentElement.lang);
    const path = await open({
      multiple: false,
      title: labels.openDocument,
      filters: [{ name: labels.documents, extensions }],
    });
    return typeof path === 'string' ? invoke('read_user_document', { path }) : null;
  },
  decodeProviderProfiles: (text) => invoke('decode_provider_profiles', { text }),
  encodeProviderProfiles: (profiles) => invoke('encode_provider_profiles', { profiles }),
  listProviderProfiles: () => (isTauri() ? invoke('list_provider_profiles') : Promise.resolve([])),
  saveProviderProfile: (profile, previousName, expectedProfiles, apiKey) =>
    invoke('save_provider_profile', {
      profile,
      previousName,
      expectedProfiles,
      apiKey: apiKey || null,
    }),
  saveProviderProfiles: (profiles, expectedProfiles) =>
    invoke('save_provider_profiles', { profiles, expectedProfiles: expectedProfiles ?? null }),
  discoverProvider: (settings, apiKey) =>
    invoke('discover_provider', { settings, apiKey: apiKey || null }),
  loadSettings: () => (isTauri() ? invoke('load_settings') : Promise.resolve(defaultSettings)),
  connect: (settings, apiKey, rememberKey = false, expectedRevision, forceReconnect = false) =>
    isTauri()
      ? invoke('connect_engine', {
          settings,
          apiKey: apiKey || null,
          rememberKey,
          expectedRevision: expectedRevision ?? null,
          forceReconnect,
        })
      : unavailable(),
  forgetApiKey: (settings) => invoke('forget_api_key', { settings }),
  openUserFile: (kind) => invoke('open_user_file', { kind }),
  rpc: (method, params) => (isTauri() ? invoke('engine_rpc', { method, params }) : unavailable()),
  subscribe: async (handler) =>
    isTauri() ? listen<RpcEvent>('engine-event', (e) => handler(e.payload)) : () => {},
  chooseDirectory: async () =>
    isTauri()
      ? ((await open({
          directory: true,
          multiple: false,
          title: nativeDialogText(document.documentElement.lang).openProject,
        })) as string | null)
      : unavailable(),
  chooseAttachments: async () =>
    isTauri()
      ? (((await open({
          multiple: true,
          title: nativeDialogText(document.documentElement.lang).addAttachments,
        })) ?? []) as string[])
      : unavailable(),
  listFiles: (root, relative) => invoke('list_files', { root, relative }),
  readFile: (root, relative) => invoke('read_file', { root, relative }),
  saveFile: (root, relative, expected, content) =>
    invoke('save_file', { root, relative, expected, content }),
  repoStatus: (root) => invoke('repo_status', { root }),
  gitAction: (root, action) => invoke('git_action', { root, action }),
  gitBranches: (root) => invoke('git_branches', { root }),
  gitOperation: (root) => invoke('git_operation', { root }),
  gitConflictVersions: (root, path) => invoke('git_conflict_versions', { root, path }),
  listCheckpoints: (root) => invoke('list_checkpoints', { root }),
  listMcpDefinitions: () => invoke('list_mcp_definitions'),
  saveMcpDefinition: (definition) => invoke('save_mcp_definition', { definition }),
  fileDiff: (root, relative, staged) => invoke('file_diff', { root, relative, staged }),
  executeTerminal: (cwd, command, processId) =>
    invoke('execute_terminal', { cwd, command, processId }),
  loadPreferences: () =>
    isTauri()
      ? invoke('load_preferences')
      : Promise.resolve({ font_size: 14, sidebar_width: 246, inspector_width: 294 }),
  saveFontSize: (size) => invoke('save_font_size', { size }),
  savePanelWidth: (panel, width) => invoke('save_panel_width', { panel, width }),
  openTerminal: (cwd, processId, rows, cols) =>
    invoke('open_terminal', { cwd, processId, rows, cols }),
  answerAgent: (id, answers) => invoke('answer_agent', { id, answers }),
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

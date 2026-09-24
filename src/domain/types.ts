import type { ModelSelection } from './modelSelection';

export interface Settings {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  proxyUrl: string;
}

export const defaultSettings: Settings = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKeyEnv: 'OPENAI_API_KEY',
  proxyUrl: 'http://127.0.0.1:14455/',
};

export interface Project {
  id: string;
  name: string;
  path: string;
}
export interface Task {
  selection?: ModelSelection;
  id: string;
  projectId: string;
  title: string;
  updatedAt: number;
  archived: boolean;
}
export interface Catalog {
  lastModel?: string;
  version: 1;
  projects: Project[];
  tasks: Task[];
}
export interface RpcEvent {
  method: string;
  params?: Record<string, unknown>;
}
export interface Entry {
  name: string;
  path: string;
  directory: boolean;
}
export interface Change {
  path: string;
  status: string;
}
export interface RepoStatus {
  branch: string;
  changes: Change[];
  git: boolean;
}
export interface ChatItem {
  id: string;
  kind: 'user' | 'assistant' | 'command' | 'file' | 'reasoning' | 'tool' | 'plan';
  text: string;
  detail?: string;
  status?: string;
  cwd?: string;
  exitCode?: number | null;
  durationMs?: number | null;
}
export interface Conversation {
  items: ChatItem[];
  turnId: string | null;
  busy: boolean;
  error: string | null;
  diff: string;
}
export const emptyConversation = (): Conversation => ({
  items: [],
  turnId: null,
  busy: false,
  error: null,
  diff: '',
});

export function validateSettings(s: Settings): string | null {
  try {
    const base = new URL(s.baseUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return '服务地址必须是不含凭据、查询参数和片段的 HTTP(S) URL。';
    const proxy = new URL(s.proxyUrl);
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password)
      return '代理地址必须是不含凭据的 HTTP(S) URL。';
  } catch {
    return '请输入有效的服务地址和代理地址。';
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.apiKeyEnv)) return 'API Key 环境变量名称无效。';
  if (!s.model.trim()) return '请填写模型 ID。';
  return null;
}

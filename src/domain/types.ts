import { validPricing, type Pricing } from './pricing';
import type { ModelSelection } from './modelSelection';

export interface Settings {
  pricing?: Pricing | null;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  proxyUrl: string;
  contextWindow?: number | null;
  autoCompactTokens?: number | null;
}

export const defaultSettings: Settings = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKeyEnv: 'OPENAI_API_KEY',
  proxyUrl: '',
};

export interface Project {
  closed?: boolean;
  worktreeParentId?: string;
  imported?: boolean;
  id: string;
  name: string;
  path: string;
}
export interface Task {
  imported?: { fingerprint: string; sourceId: string; sourceProject: string };
  pinned?: boolean;
  forkedFrom?: string;
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
  steps?: { text: string; status: string }[];
  id: string;
  kind:
    | 'user'
    | 'assistant'
    | 'command'
    | 'file'
    | 'reasoning'
    | 'tool'
    | 'plan'
    | 'compaction'
    | 'agent';
  text: string;
  detail?: string;
  status?: string;
  cwd?: string;
  exitCode?: number | null;
  durationMs?: number | null;
}
export interface Conversation {
  recoveredTurn?: { id: string; status: string; error?: string };
  lastTurnStatus?: string;
  activeModel?: string;
  usage?: {
    input: number;
    output: number;
    cached: number;
    reasoning: number;
    total: number;
    context: number | null;
    lastInput: number;
    lastTotal: number;
    lastCached: number;
    lastOutput: number;
    model?: string;
  };
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
  if (s.pricing && !validPricing(s.pricing)) return '价格配置无效';
  for (const value of [s.contextWindow, s.autoCompactTokens]) {
    if (value != null && (!Number.isSafeInteger(value) || value < 1024 || value > 100_000_000))
      return '上下文数值必须是 1024 到 100000000 之间的整数';
  }
  if (
    s.contextWindow != null &&
    s.autoCompactTokens != null &&
    s.autoCompactTokens >= s.contextWindow
  )
    return '自动压缩阈值必须小于上下文窗口';
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
    if (s.proxyUrl.trim()) {
      const proxy = new URL(s.proxyUrl);
      if (
        !['http:', 'https:'].includes(proxy.protocol) ||
        proxy.username ||
        proxy.password ||
        proxy.search ||
        proxy.hash
      )
        return '代理地址必须是不含凭据的 HTTP(S) URL。';
    }
  } catch {
    return '请输入有效的服务地址和代理地址。';
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.apiKeyEnv)) return 'API Key 环境变量名称无效。';
  if (!s.model.trim()) return '请填写模型 ID。';
  return null;
}

import { isModelSelection, type ModelSelection } from './modelSelection';

export interface WorkspaceSession {
  version: 1;
  projectId: string | null;
  taskId: string | null;
  drafts: Record<string, string>;
  selections: Record<string, ModelSelection>;
  panels: { sidebar: boolean; inspector: boolean; terminal: boolean };
  positions: Record<string, number>;
}
export const emptySession = (): WorkspaceSession => ({
  version: 1,
  projectId: null,
  taskId: null,
  drafts: {},
  selections: {},
  panels: { sidebar: true, inspector: true, terminal: false },
  positions: {},
});

export function parseSession(text: string | null): WorkspaceSession {
  if (!text) return emptySession();
  if (text.length > 2_000_000) throw new Error('工作现场数据超过大小上限。');
  const s: unknown = JSON.parse(text);
  if (!s || typeof s !== 'object') throw new Error('工作现场数据无效。');
  const value = s as WorkspaceSession;
  const map = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (
    value.version !== 1 ||
    ![value.projectId, value.taskId].every((v) => v === null || typeof v === 'string') ||
    !map(value.drafts) ||
    Object.keys(value.drafts).length > 1000 ||
    !Object.values(value.drafts).every((v) => typeof v === 'string' && v.length <= 100_000) ||
    !map(value.selections) ||
    !Object.values(value.selections).every(isModelSelection) ||
    !map(value.panels) ||
    !['sidebar', 'inspector', 'terminal'].every(
      (key) => typeof value.panels[key as keyof typeof value.panels] === 'boolean',
    ) ||
    !map(value.positions) ||
    !Object.values(value.positions).every(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
    )
  )
    throw new Error('工作现场数据损坏；原数据保留，可从诊断中恢复。');
  return value;
}

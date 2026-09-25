import type { Catalog, ChatItem } from './types';

const MAX_DOCUMENT = 8_388_608;
const MAX_TASKS = 100;
const MAX_MESSAGES = 50_000;
const kinds = new Set<ChatItem['kind']>([
  'user',
  'assistant',
  'command',
  'file',
  'reasoning',
  'tool',
  'plan',
  'compaction',
  'agent',
]);

export interface ImportEntry {
  sourceId: string;
  title: string;
  projectName: string;
  projectKey: string;
  updatedAt: number;
  messages: ChatItem[];
  fingerprint: string;
  duplicate: boolean;
  idConflict: boolean;
}

export interface ImportPlan {
  entries: ImportEntry[];
  projectCount: number;
  duplicateCount: number;
  idConflictCount: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('导入文件结构无效。');
  return value as Record<string, unknown>;
}

function message(value: unknown): ChatItem {
  const row = object(value);
  if (
    typeof row.id !== 'string' ||
    !row.id ||
    row.id.length > 200 ||
    typeof row.kind !== 'string' ||
    !kinds.has(row.kind as ChatItem['kind']) ||
    typeof row.text !== 'string' ||
    row.text.length > 240_000 ||
    (row.detail !== undefined && (typeof row.detail !== 'string' || row.detail.length > 240_000)) ||
    (row.status !== undefined && typeof row.status !== 'string') ||
    (row.cwd !== undefined && typeof row.cwd !== 'string') ||
    (row.exitCode !== undefined && row.exitCode !== null && typeof row.exitCode !== 'number') ||
    (row.durationMs !== undefined &&
      row.durationMs !== null &&
      typeof row.durationMs !== 'number') ||
    (row.steps !== undefined &&
      (!Array.isArray(row.steps) ||
        row.steps.length > 1000 ||
        !row.steps.every(
          (step) => step && typeof step.text === 'string' && typeof step.status === 'string',
        )))
  )
    throw new Error('导入文件含有无效消息。');
  return {
    id: row.id,
    kind: row.kind as ChatItem['kind'],
    text: row.text,
    ...(row.detail !== undefined ? { detail: row.detail as string } : {}),
    ...(row.status !== undefined ? { status: row.status as string } : {}),
    ...(row.cwd !== undefined ? { cwd: row.cwd as string } : {}),
    ...(row.exitCode !== undefined ? { exitCode: row.exitCode as number | null } : {}),
    ...(row.durationMs !== undefined ? { durationMs: row.durationMs as number | null } : {}),
    ...(row.steps !== undefined ? { steps: row.steps as ChatItem['steps'] } : {}),
  };
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

export async function planTaskImport(text: string, catalog: Catalog): Promise<ImportPlan> {
  if (!text || text.length > MAX_DOCUMENT) throw new Error('导入文件为空或超过 8 MiB。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入文件不是有效 JSON。');
  }
  const document = object(parsed);
  if (document.schemaVersion !== 1) throw new Error('不支持此对话导出版本。');
  const rows = Array.isArray(document.entries)
    ? document.entries
    : document.task && Array.isArray(document.messages)
      ? [document]
      : null;
  if (!rows || !rows.length || rows.length > MAX_TASKS)
    throw new Error('导入文件必须包含 1 到 100 个任务。');
  const existing = new Set(catalog.tasks.map((task) => task.imported?.fingerprint).filter(Boolean));
  const sourceIds = new Set(catalog.tasks.map((task) => task.id));
  const seen = new Set<string>();
  let messageCount = 0;
  const entries: ImportEntry[] = [];
  for (const value of rows) {
    const row = object(value);
    const task = object(row.task);
    const sourceId = task.id;
    const title = task.title;
    if (
      typeof sourceId !== 'string' ||
      !sourceId ||
      sourceId.length > 200 ||
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 200 ||
      !Array.isArray(row.messages)
    )
      throw new Error('导入文件含有无效任务。');
    messageCount += row.messages.length;
    if (messageCount > MAX_MESSAGES) throw new Error('导入文件消息数量超过上限。');
    const project = row.project == null ? null : object(row.project);
    if (
      project &&
      (typeof project.name !== 'string' ||
        project.name.length > 200 ||
        typeof project.path !== 'string' ||
        project.path.length > 4000)
    )
      throw new Error('导入文件含有无效项目。');
    const projectName =
      typeof project?.name === 'string' && project.name ? project.name : '导入的对话';
    const projectKey = project ? `${project.path}\n${project.name}` : '';
    const messages = row.messages.map(message);
    const hash = await fingerprint({ sourceId, projectKey, messages });
    entries.push({
      sourceId,
      title: title.trim(),
      projectName,
      projectKey,
      updatedAt:
        typeof task.updatedAt === 'number' && Number.isFinite(task.updatedAt)
          ? task.updatedAt
          : Date.now(),
      messages,
      fingerprint: hash,
      duplicate: existing.has(hash) || seen.has(hash),
      idConflict: sourceIds.has(sourceId),
    });
    seen.add(hash);
  }
  return {
    entries,
    projectCount: new Set(entries.map((entry) => entry.projectKey)).size,
    duplicateCount: entries.filter((entry) => entry.duplicate).length,
    idConflictCount: entries.filter((entry) => entry.idConflict).length,
  };
}

export function parseImportedHistory(text: string): ChatItem[] {
  if (!text || text.length > MAX_DOCUMENT) throw new Error('导入历史文件为空或超过大小上限。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入历史不是有效 JSON。');
  }
  const record = object(parsed);
  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.messages) ||
    record.messages.length > MAX_MESSAGES
  )
    throw new Error('导入历史格式或版本无效。');
  return record.messages.map(message);
}

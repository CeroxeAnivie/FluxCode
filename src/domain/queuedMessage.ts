import { isModelSelection, type ModelSelection } from './modelSelection';
import { validateAttachments, type Attachment } from './attachments';
import { errorMessage } from './errors';
export interface QueuedMessage {
  id: string;
  threadId: string;
  text: string;
  selection: ModelSelection;
  attachments: Attachment[];
  status: 'waiting' | 'sending' | 'paused' | 'failed';
  turnId?: string;
  error?: string;
}

export function settleQueuedMessage(
  items: QueuedMessage[],
  id: string,
  result: { status: string; turnId?: string; error?: string },
): QueuedMessage[] {
  if (!items.some((item) => item.id === id && item.status === 'sending')) return items;
  if (result.status === 'completed') return items.filter((item) => item.id !== id);
  return items.map((item) =>
    item.id === id
      ? {
          ...item,
          status: 'failed' as const,
          turnId: result.turnId ?? item.turnId,
          error: result.error
            ? errorMessage(result.error, 'zh-CN')
            : '任务未完成，请检查历史后重试。',
        }
      : item,
  );
}

export function parseQueue(raw: string | null): QueuedMessage[] {
  if (!raw) return [];
  if (raw.length > 2_000_000) throw new Error('Queue storage limit exceeded');
  const items: unknown = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > 50) throw new Error('Invalid queue');
  return items.map((value) => {
    const row = value as QueuedMessage;
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      row.id.length > 200 ||
      typeof row.threadId !== 'string' ||
      !row.threadId ||
      row.threadId.length > 200 ||
      typeof row.text !== 'string' ||
      !row.text.trim() ||
      row.text.length > 100000 ||
      !isModelSelection(row.selection) ||
      !['waiting', 'sending', 'paused', 'failed'].includes(row.status) ||
      (row.turnId !== undefined &&
        (typeof row.turnId !== 'string' || !row.turnId || row.turnId.length > 200)) ||
      !Array.isArray(row.attachments) ||
      (row.error !== undefined && (typeof row.error !== 'string' || row.error.length > 16_000))
    )
      throw new Error('Invalid queued message');
    validateAttachments(row.attachments);
    const safeError = row.error ? errorMessage(row.error, 'zh-CN') : undefined;
    if (row.status === 'paused') return { ...row, status: 'paused', error: safeError };
    if (row.status === 'failed') return { ...row, status: 'failed', error: safeError };
    return { ...row, status: 'failed', error: '应用已重启，请确认上一轮状态后继续发送。' };
  });
}

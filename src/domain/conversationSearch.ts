import { normalizeItem } from './conversation';
import type { ChatItem } from './types';

export interface SearchHit {
  taskId: string;
  itemId: string;
  snippet: string;
}

export function findMessages(
  taskId: string,
  rawItems: unknown[],
  query: string,
  limit: number,
): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2 || limit <= 0) return [];
  const matches: SearchHit[] = [];
  for (const raw of rawItems) {
    const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const item =
      typeof record.kind === 'string' &&
      typeof record.id === 'string' &&
      typeof record.text === 'string'
        ? (record as unknown as ChatItem)
        : normalizeItem(raw);
    if (!item) continue;
    const original = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const body = searchableBody(item, original);
    const index = body.toLocaleLowerCase().indexOf(needle);
    if (index < 0) continue;
    const start = Math.max(0, index - 70);
    const end = Math.min(body.length, index + needle.length + 110);
    matches.push({
      taskId,
      itemId: item.id,
      snippet: `${start ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ')}${end < body.length ? '…' : ''}`,
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

function searchableBody(item: ChatItem, raw: Record<string, unknown>): string {
  const fullOutput = typeof raw.aggregatedOutput === 'string' ? raw.aggregatedOutput : item.detail;
  return [item.text, fullOutput].filter(Boolean).join('\n');
}

import { bridge } from './bridge';
import { findMessages, type SearchHit } from '../domain/conversationSearch';
import type { Task } from '../domain/types';
import { loadImportedHistory } from './importedHistory';

const MAX_RESULTS = 100;
const MAX_ITEMS_PER_TASK = 10_000;
const PAGE_SIZE = 100;

export interface SearchProgress {
  completed: number;
  total: number;
  hits: SearchHit[];
  truncated: boolean;
}

async function readItems(
  threadId: string,
  cancelled: () => boolean,
): Promise<{ items: unknown[]; truncated: boolean }> {
  const result = await bridge.rpc<{
    thread: { historyMode?: string; turns?: { items?: unknown[] }[] };
  }>('thread/read', { threadId, includeTurns: true });
  if (result.thread.historyMode !== 'paginated') {
    const items: unknown[] = [];
    for (const turn of result.thread.turns ?? []) {
      for (const item of turn.items ?? []) {
        if (cancelled()) return { items, truncated: false };
        if (items.length === MAX_ITEMS_PER_TASK) return { items, truncated: true };
        items.push(item);
      }
    }
    return { items, truncated: false };
  }
  const items: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ITEMS_PER_TASK / PAGE_SIZE; page++) {
    if (cancelled()) return { items, truncated: false };
    const response: { data: { item: unknown }[]; nextCursor: string | null } = await bridge.rpc(
      'thread/items/list',
      { threadId, cursor, limit: PAGE_SIZE, sortDirection: 'asc' },
    );
    if (cancelled()) return { items, truncated: false };
    items.push(...response.data.slice(0, PAGE_SIZE).map((row) => row.item));
    if (response.data.length > PAGE_SIZE) return { items, truncated: true };
    const nextCursor = response.nextCursor;
    if (!nextCursor) return { items, truncated: false };
    if (!response.data.length || seenCursors.has(nextCursor)) return { items, truncated: true };
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return { items, truncated: true };
}

export async function searchConversations(
  tasks: Task[],
  query: string,
  cancelled: () => boolean,
  onProgress: (progress: SearchProgress) => void,
): Promise<void> {
  const work = tasks.filter((task) => !!task.id);
  let cursor = 0;
  let completed = 0;
  let truncated = false;
  const hits: SearchHit[] = [];
  async function worker() {
    while (!cancelled() && cursor < work.length && hits.length < MAX_RESULTS) {
      const task = work[cursor++];
      const result = task.imported
        ? await loadImportedHistory(task.id).then(({ items }) => ({
            items: items.slice(0, MAX_ITEMS_PER_TASK),
            truncated: items.length > MAX_ITEMS_PER_TASK,
          }))
        : await readItems(task.id, cancelled);
      if (cancelled()) return;
      hits.push(...findMessages(task.id, result.items, query, MAX_RESULTS - hits.length));
      truncated ||= result.truncated;
      completed++;
      onProgress({ completed, total: work.length, hits: [...hits], truncated });
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, work.length) }, () => worker()));
  if (!cancelled() && (cursor < work.length || hits.length >= MAX_RESULTS)) {
    onProgress({ completed, total: work.length, hits: [...hits], truncated: true });
  }
}

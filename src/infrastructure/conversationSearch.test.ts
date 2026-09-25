import { beforeEach, expect, it, vi } from 'vitest';
import { bridge } from './bridge';
import { searchConversations, type SearchProgress } from './conversationSearch';
import type { Task } from '../domain/types';

vi.mock('./bridge', () => ({ bridge: { rpc: vi.fn() } }));

const task: Task = {
  id: 'thread-1',
  projectId: 'project-1',
  title: 'Build',
  updatedAt: 1,
  archived: false,
};

const message = (id: string, text = 'matching text') => ({ id, kind: 'assistant', text });

beforeEach(() => vi.mocked(bridge.rpc).mockReset());

it('stops paginated reads immediately after cancellation and publishes no stale results', async () => {
  let cancelled = false;
  const progress = vi.fn();
  vi.mocked(bridge.rpc).mockImplementation(async (method) => {
    if (method === 'thread/read') return { thread: { historyMode: 'paginated' } } as never;
    cancelled = true;
    return { data: [{ item: message('first') }], nextCursor: 'more' } as never;
  });

  await searchConversations([task], 'matching', () => cancelled, progress);

  expect(bridge.rpc).toHaveBeenCalledTimes(2);
  expect(progress).not.toHaveBeenCalled();
});

it('stops a cycling cursor with a truncated result instead of polling every page', async () => {
  let page = 0;
  const updates: SearchProgress[] = [];
  vi.mocked(bridge.rpc).mockImplementation(async (method) => {
    if (method === 'thread/read') return { thread: { historyMode: 'paginated' } } as never;
    return {
      data: [{ item: message(`item-${++page}`) }],
      nextCursor: 'same-cursor',
    } as never;
  });

  await searchConversations(
    [task],
    'matching',
    () => false,
    (update) => updates.push(update),
  );

  expect(bridge.rpc).toHaveBeenCalledTimes(3);
  expect(updates.at(-1)).toMatchObject({ completed: 1, truncated: true });
  expect(updates.at(-1)?.hits.map((hit) => hit.itemId)).toEqual(['item-1', 'item-2']);
});

it('stops an empty page that incorrectly advertises more results', async () => {
  const updates: SearchProgress[] = [];
  vi.mocked(bridge.rpc).mockImplementation(async (method) =>
    method === 'thread/read'
      ? ({ thread: { historyMode: 'paginated' } } as never)
      : ({ data: [], nextCursor: 'more' } as never),
  );

  await searchConversations(
    [task],
    'matching',
    () => false,
    (update) => updates.push(update),
  );

  expect(bridge.rpc).toHaveBeenCalledTimes(2);
  expect(updates.at(-1)).toMatchObject({ completed: 1, truncated: true, hits: [] });
});

it('caps an oversized protocol page and marks results incomplete', async () => {
  const updates: SearchProgress[] = [];
  vi.mocked(bridge.rpc).mockImplementation(async (method) =>
    method === 'thread/read'
      ? ({ thread: { historyMode: 'paginated' } } as never)
      : ({
          data: Array.from({ length: 500 }, (_, index) => ({ item: message(`item-${index}`) })),
          nextCursor: 'more',
        } as never),
  );

  await searchConversations(
    [task],
    'matching',
    () => false,
    (update) => updates.push(update),
  );

  expect(bridge.rpc).toHaveBeenCalledTimes(2);
  expect(updates.at(-1)).toMatchObject({ truncated: true });
  expect(updates.at(-1)?.hits).toHaveLength(100);
  expect(updates.at(-1)?.hits.at(-1)?.itemId).toBe('item-99');
});

it('caps legacy non-paginated history before scanning a matching tail', async () => {
  const updates: SearchProgress[] = [];
  vi.mocked(bridge.rpc).mockResolvedValue({
    thread: {
      turns: [
        {
          items: [
            ...Array.from({ length: 10_000 }, (_, index) => message(`item-${index}`, 'other')),
            message('tail', 'matching'),
          ],
        },
      ],
    },
  } as never);

  await searchConversations(
    [task],
    'matching',
    () => false,
    (update) => updates.push(update),
  );

  expect(bridge.rpc).toHaveBeenCalledTimes(1);
  expect(updates.at(-1)).toMatchObject({ completed: 1, truncated: true, hits: [] });
});

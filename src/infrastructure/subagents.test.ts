import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./bridge', () => ({ bridge: { rpc } }));
import { listSubagents, readSubagent } from './subagents';
beforeEach(() => rpc.mockReset());

describe('read-only subagent history', () => {
  it('reads live state and preserves native errors without resuming the thread', async () => {
    rpc.mockResolvedValue({
      thread: {
        id: 'child',
        agentNickname: 'Reviewer',
        status: { type: 'idle' },
        turns: [
          {
            id: 't',
            status: 'failed',
            error: { message: 'quota reached' },
            items: [{ type: 'agentMessage', id: 'a', text: 'Partial answer' }],
          },
        ],
      },
    });
    const result = await readSubagent('child', true, () => false);
    expect(result.status).toBe('errored');
    expect(result.conversation?.error).toBe('quota reached');
    expect(result.conversation?.items[0].text).toBe('Partial answer');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('thread/read', {
      threadId: 'child',
      includeTurns: true,
    });
  });
  it('loads descending pages into chronological order and bounds repeated cursors', async () => {
    rpc.mockResolvedValueOnce({
      thread: { id: 'child', status: { type: 'active' }, historyMode: 'paginated', turns: [] },
    });
    rpc.mockResolvedValueOnce({
      data: [{ item: { id: 'b', type: 'agentMessage', text: 'Latest' } }],
      nextCursor: 'same',
    });
    rpc.mockResolvedValueOnce({
      data: [{ item: { id: 'a', type: 'agentMessage', text: 'Earlier' } }],
      nextCursor: 'same',
    });
    const result = await readSubagent('child', true, () => false);
    expect(result.conversation?.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.truncated).toBe(true);
    expect(result.status).toBe('running');
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it('rejects mismatched identities and stops paging on navigation', async () => {
    rpc.mockResolvedValueOnce({ thread: { id: 'other' } });
    await expect(readSubagent('child', true, () => false)).rejects.toThrow('会话标识');
    rpc.mockResolvedValueOnce({ thread: { id: 'child', historyMode: 'paginated', turns: [] } });
    await readSubagent('child', true, () => true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

it('discovers nested descendants through the ancestor filter and preserves pagination', async () => {
  rpc.mockResolvedValueOnce({
    data: [
      {
        id: 'nested',
        source: { subAgent: { thread_spawn: { agent_path: '/root/reviewer/tests' } } },
        status: { type: 'active' },
        model: 'child-model',
      },
    ],
    nextCursor: 'page-2',
  });
  const result = await listSubagents('parent', null);
  expect(result.agents[0].name).toBe('/root/reviewer/tests');
  expect(result.nextCursor).toBe('page-2');
  expect(rpc).toHaveBeenCalledWith(
    'thread/list',
    expect.objectContaining({ ancestorThreadId: 'parent', sourceKinds: ['subAgentThreadSpawn'] }),
  );
});
it('reads the last turn summary to distinguish a finished child from an idle child', async () => {
  rpc.mockResolvedValueOnce({ thread: { id: 'child', status: { type: 'idle' }, turns: [] } });
  rpc.mockResolvedValueOnce({ data: [{ id: 'last', status: 'completed', items: [] }] });
  expect((await readSubagent('child', false, () => false)).status).toBe('completed');
});

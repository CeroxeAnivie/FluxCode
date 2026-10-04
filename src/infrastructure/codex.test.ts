import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./bridge', () => ({ bridge: { rpc } }));
vi.mock('./modelIdentity', () => ({ readTurnIdentities: () => ({}) }));
import { resumeThread } from './codex';
beforeEach(() => rpc.mockReset());
it('restores a failed main conversation with its complete cause', async () => {
  rpc.mockResolvedValueOnce({
    thread: {
      turns: [
        {
          id: 't',
          status: 'failed',
          error: { message: 'HTTP 429', additionalDetails: 'Daily quota exhausted' },
          items: [],
        },
      ],
    },
  });
  const result = await resumeThread('main');
  expect(result.error).toBe('HTTP 429\nDaily quota exhausted');
  expect(result.busy).toBe(false);
});
it('reads the terminal status of paginated history instead of discarding the failure', async () => {
  rpc.mockResolvedValueOnce({ thread: { historyMode: 'paginated', turns: [] } });
  rpc.mockResolvedValueOnce({ data: [{ id: 't', status: 'failed', items: [] }] });
  rpc.mockResolvedValueOnce({ data: [], nextCursor: null });
  const result = await resumeThread('main');
  expect(result.error).toContain('未提供具体原因');
  expect(rpc).toHaveBeenCalledWith(
    'thread/turns/list',
    expect.objectContaining({ limit: 1, sortDirection: 'desc' }),
  );
});

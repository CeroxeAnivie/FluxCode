import { describe, expect, it } from 'vitest';
import { settleQueuedMessage, type QueuedMessage } from './queuedMessage';

const sending: QueuedMessage = {
  id: 'queued-1',
  threadId: 'thread-1',
  text: 'Continue the task',
  selection: { model: 'fixture', effort: 'off' },
  attachments: [],
  status: 'sending',
};

describe('queued turn reconciliation', () => {
  it('removes a message only after confirmed completion', () => {
    const waiting: QueuedMessage = { ...sending, id: 'queued-2', status: 'waiting' };
    expect(
      settleQueuedMessage([sending, waiting], sending.id, {
        status: 'completed',
        turnId: 'turn-1',
      }),
    ).toEqual([waiting]);
  });

  it('retains failed and unknown outcomes for explicit review', () => {
    const failed = settleQueuedMessage([sending], sending.id, {
      status: 'failed',
      turnId: 'turn-1',
      error: 'Streaming response interrupted',
    });
    expect(failed[0]).toMatchObject({
      status: 'failed',
      turnId: 'turn-1',
    });
    expect(failed[0].error).toContain('操作未完成');
    const unknown = settleQueuedMessage([sending], sending.id, { status: 'unknown' });
    expect(unknown[0]).toMatchObject({
      status: 'failed',
      error: '任务未完成，请检查历史后重试。',
    });
    expect(settleQueuedMessage([sending], 'other', { status: 'completed' })).toEqual([sending]);
  });

  it('does not consume a message that is not being sent', () => {
    const paused: QueuedMessage = { ...sending, status: 'paused' };
    expect(settleQueuedMessage([paused], paused.id, { status: 'completed' })).toEqual([paused]);
  });
});

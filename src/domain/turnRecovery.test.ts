import { describe, expect, it } from 'vitest';
import { emptyConversation } from './types';
import { recoverFinishedTurn } from './turnRecovery';

describe('missed completion recovery', () => {
  const running = { ...emptyConversation(), busy: true, turnId: 'active' };
  it('restores final output and completion identity for queue settlement', () => {
    const result = recoverFinishedTurn(running, {
      id: 'active',
      status: 'completed',
      items: [{ id: 'answer', type: 'agentMessage', text: 'Finished' }],
    });
    expect(result.busy).toBe(false);
    expect(result.items[0].text).toBe('Finished');
    expect(result.recoveredTurn?.id).toBe('active');
  });
  it('does not overwrite a newer turn or settle an unconfirmed outcome', () => {
    expect(recoverFinishedTurn(running, { id: 'older', status: 'completed', items: [] })).toBe(
      running,
    );
    expect(recoverFinishedTurn(running, { id: 'active', status: 'inProgress', items: [] })).toBe(
      running,
    );
  });
  it('preserves the actual failure instead of reporting success', () => {
    const result = recoverFinishedTurn(running, {
      id: 'active',
      status: 'failed',
      items: [],
      error: { message: 'Connection lost' },
    });
    expect(result.error).toBe('Connection lost');
    expect(result.recoveredTurn?.status).toBe('failed');
  });
});

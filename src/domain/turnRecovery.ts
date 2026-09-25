import { normalizeItem, reduceEvent, upsert } from './conversation';
import type { Conversation } from './types';

export interface TurnSnapshot {
  id: string;
  status: string;
  items: unknown[];
  error?: { message: string } | null;
}

/** Only a confirmed terminal snapshot of the still-active turn can settle it. */
export function recoverFinishedTurn(state: Conversation, turn: TurnSnapshot): Conversation {
  if (
    !state.busy ||
    state.turnId !== turn.id ||
    !['completed', 'failed', 'interrupted'].includes(turn.status)
  )
    return state;
  let items = state.items;
  for (const value of turn.items) {
    const item = normalizeItem(value);
    if (item) items = upsert(items, item);
  }
  return {
    ...reduceEvent({ ...state, items }, { method: 'turn/completed', params: { turn } }),
    recoveredTurn: { id: turn.id, status: turn.status, error: turn.error?.message },
  };
}

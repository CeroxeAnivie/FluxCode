import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./uiStateMirror', () => ({ scheduleUiStateMirror: vi.fn() }));
import { copyTurnIdentities, readTurnIdentities, saveTurnIdentity } from './modelIdentity';
import { reduceEvent } from '../domain/conversation';
import { emptyConversation } from '../domain/types';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it('keeps each turn model immutable across switches, restore and fork', () => {
  saveTurnIdentity('parent', 'turn-a', { model: 'model-a' });
  saveTurnIdentity('parent', 'turn-b', { model: 'model-b' });
  saveTurnIdentity('parent', 'turn-a', { model: 'incorrect-new-model' });
  expect(readTurnIdentities('parent')).toEqual({
    'turn-a': { model: 'model-a' },
    'turn-b': { model: 'model-b' },
  });
  copyTurnIdentities('parent', 'fork');
  expect(readTurnIdentities('fork')).toEqual(readTurnIdentities('parent'));
});
it('preserves streamed message identity when the selection changes before completion', () => {
  let state = reduceEvent(
    { ...emptyConversation(), activeIdentity: { model: 'first' } },
    {
      method: 'item/agentMessage/delta',
      params: { itemId: 'a', delta: 'Hello' },
    },
  );
  state = reduceEvent(
    { ...state, activeIdentity: { model: 'second' } },
    {
      method: 'item/completed',
      params: { item: { type: 'agentMessage', id: 'a', text: 'Hello world' } },
    },
  );
  expect(state.items[0].identity?.model).toBe('first');
});
it('rejects corrupt attribution without replacing the original record', () => {
  localStorage.setItem('fluxcode.turn-identities.parent', '{');
  expect(() => saveTurnIdentity('parent', 'turn', { model: 'new' })).toThrow();
  expect(localStorage.getItem('fluxcode.turn-identities.parent')).toBe('{');
});

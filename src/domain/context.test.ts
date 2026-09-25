import { describe, expect, it } from 'vitest';
import { defaultSettings, emptyConversation, validateSettings } from './types';
import { reduceEvent, hydrateItems } from './conversation';

const settings = { ...defaultSettings, model: 'fixture' };
describe('context budget and compaction contracts', () => {
  it('accepts model defaults and independent overrides', () => {
    expect(validateSettings(settings)).toBeNull();
    expect(
      validateSettings({ ...settings, contextWindow: 200000, autoCompactTokens: 160000 }),
    ).toBeNull();
    expect(validateSettings({ ...settings, autoCompactTokens: 1024 })).toBeNull();
    expect(
      validateSettings({ ...settings, contextWindow: null, autoCompactTokens: null }),
    ).toBeNull();
  });
  it('rejects invalid numbers and thresholds without modifying settings', () => {
    for (const value of [0, -1, 1023, 1024.5, Infinity, NaN, 100000001])
      expect(validateSettings({ ...settings, contextWindow: value })).not.toBeNull();
    expect(
      validateSettings({ ...settings, contextWindow: 4096, autoCompactTokens: 4096 }),
    ).not.toBeNull();
  });
  it('retains history and follows native compaction lifecycle', () => {
    let state = {
      ...emptyConversation(),
      items: hydrateItems([{ type: 'agentMessage', id: 'a', text: 'Keep history' }]),
    };
    state = reduceEvent(state, { method: 'turn/started', params: { turn: { id: 'c' } } });
    state = reduceEvent(state, {
      method: 'item/started',
      params: { item: { type: 'contextCompaction', id: 'compact' } },
    });
    expect(state.busy).toBe(true);
    expect(state.items.at(-1)?.status).toBe('inProgress');
    state = reduceEvent(state, {
      method: 'item/completed',
      params: { item: { type: 'contextCompaction', id: 'compact' } },
    });
    expect(state.busy).toBe(true);
    state = reduceEvent(state, {
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    });
    expect(state.busy).toBe(false);
    expect(state.items[0].text).toBe('Keep history');
    expect(state.items.at(-1)?.status).toBe('completed');
    expect(hydrateItems([{ type: 'contextCompaction', id: 'compact' }])[0].kind).toBe('compaction');
  });
  it('marks interrupted compaction without losing conversation history', () => {
    const state = reduceEvent(
      {
        ...emptyConversation(),
        busy: true,
        items: [{ id: 'c', kind: 'compaction', text: '', status: 'inProgress' }],
      },
      { method: 'turn/completed', params: { turn: { status: 'interrupted' } } },
    );
    expect(state.items[0].status).toBe('interrupted');
    expect(state.busy).toBe(false);
  });
  it('separates latest context from cumulative usage and surfaces failures', () => {
    let state = reduceEvent(emptyConversation(), {
      method: 'thread/tokenUsage/updated',
      params: {
        tokenUsage: {
          total: { totalTokens: 9000 },
          last: { inputTokens: 1000, totalTokens: 1200 },
          modelContextWindow: 4000,
        },
      },
    });
    expect(state.usage?.lastTotal).toBe(1200);
    expect(state.usage?.total).toBe(9000);
    state = reduceEvent(
      { ...state, busy: true },
      { method: 'turn/completed', params: { turn: { error: { message: 'fixture failure' } } } },
    );
    expect(state.error).toBe('fixture failure');
    expect(state.busy).toBe(false);
  });
});

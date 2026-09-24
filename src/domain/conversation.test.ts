import { describe, expect, it } from 'vitest';
import { hydrateItems, reduceEvent } from './conversation';
import { defaultSettings, emptyConversation, validateSettings } from './types';

describe('conversation lifecycle', () => {
  it('merges streaming output into one canonical completed item', () => {
    let c = reduceEvent(emptyConversation(), {
      method: 'turn/started',
      params: { turn: { id: 'turn-1' } },
    });
    c = reduceEvent(c, {
      method: 'item/agentMessage/delta',
      params: { itemId: 'a', delta: 'Hello ' },
    });
    c = reduceEvent(c, {
      method: 'item/agentMessage/delta',
      params: { itemId: 'a', delta: '世界' },
    });
    c = reduceEvent(c, {
      method: 'item/completed',
      params: { item: { type: 'agentMessage', id: 'a', text: 'Hello 世界' } },
    });
    expect(c.items).toHaveLength(1);
    expect(c.items[0].text).toBe('Hello 世界');
    c = reduceEvent(c, {
      method: 'turn/completed',
      params: { turn: { id: 'turn-1', status: 'completed' } },
    });
    expect(c.busy).toBe(false);
    expect(c.turnId).toBeNull();
  });
  it('preserves failures and interruption without inventing success', () => {
    const result = reduceEvent(
      { ...emptyConversation(), busy: true },
      {
        method: 'turn/completed',
        params: { turn: { status: 'failed', error: { message: 'Rate limit' } } },
      },
    );
    expect(result.error).toBe('Rate limit');
    expect(result.busy).toBe(false);
  });
  it('bounds command output and ignores unknown events', () => {
    const c = reduceEvent(emptyConversation(), {
      method: 'item/commandExecution/outputDelta',
      params: { itemId: 'cmd', delta: 'x'.repeat(300_000) },
    });
    expect(c.items[0].detail!.length).toBeLessThan(240_000);
    expect(reduceEvent(c, { method: 'new/futureEvent' })).toBe(c);
  });
  it('hydrates user and file items and deduplicates by ID', () => {
    const items = hydrateItems([
      { type: 'userMessage', id: 'u', content: [{ type: 'text', text: '修复' }] },
      { type: 'agentMessage', id: 'a', text: 'old' },
      { type: 'agentMessage', id: 'a', text: 'new' },
      { type: 'future', id: 'x' },
    ]);
    expect(items).toHaveLength(2);
    expect(items[1].text).toBe('new');
  });
});

describe('settings validation', () => {
  const valid = { ...defaultSettings, model: 'model-id' };
  it('accepts Responses endpoint and rejects missing model', () => {
    expect(validateSettings(valid)).toBeNull();
    expect(validateSettings(defaultSettings)).toContain('模型');
  });
  it('rejects credential URLs, non-HTTP protocols and unsafe variable names', () => {
    for (const baseUrl of [
      'file:///tmp',
      'https://secret@example.com/v1',
      'https://example.com/v1?token=secret',
    ])
      expect(validateSettings({ ...valid, baseUrl })).not.toBeNull();
    expect(validateSettings({ ...valid, apiKeyEnv: 'KEY;whoami' })).not.toBeNull();
  });
});

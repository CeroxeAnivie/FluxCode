import { describe, it, expect } from 'vitest';
import { estimateCost, validPricing } from './pricing';
import { exportTask } from './taskExport';
import { emptyConversation } from './types';
import { parseQueue } from './queuedMessage';
import { reduceEvent } from './conversation';
describe('product contracts', () => {
  it('prices cached tokens once and never invents a rate for another model', () => {
    const pricing = { model: 'a', currency: 'USD', input: 2, cached: 0.5, output: 10 };
    expect(
      estimateCost(pricing, 'a', { input: 1000000, cached: 200000, output: 100000 }),
    ).toBeCloseTo(2.7);
    expect(estimateCost(pricing, 'b', { input: 1, cached: 0, output: 1 })).toBeNull();
    expect(validPricing({ ...pricing, input: NaN })).toBe(false);
  });
  it('exports complete loaded messages with safe fences and a versioned format', () => {
    const task = { id: 't', title: '任务', projectId: 'p', updatedAt: 0, archived: false };
    const conversation = {
      ...emptyConversation(),
      items: [{ id: 'a', kind: 'assistant' as const, text: '```\ncode' }],
    };
    expect(exportTask(task, conversation, 'markdown')).toContain('````text');
    expect(JSON.parse(exportTask(task, conversation, 'json')).messages[0].text).toBe('```\ncode');
  });
  it('never automatically replays a persisted queued action after restart', () => {
    const message = {
      id: '1',
      threadId: 't',
      text: 'task',
      selection: { model: 'm', effort: 'off' },
      attachments: [],
      status: 'sending',
    };
    expect(parseQueue(JSON.stringify([message]))[0].status).toBe('failed');
    expect(parseQueue(JSON.stringify([{ ...message, status: 'waiting' }]))[0].status).toBe(
      'failed',
    );
    expect(parseQueue(JSON.stringify([{ ...message, status: 'paused' }]))[0].status).toBe('paused');
    expect(
      parseQueue(
        JSON.stringify([
          { ...message, status: 'paused', error: 'provider secret sk-fixture-value' },
        ]),
      )[0].error,
    ).not.toContain('sk-fixture-value');
    expect(() => parseQueue(JSON.stringify([{ ...message, text: 'a'.repeat(100001) }]))).toThrow();
  });
  it('updates native plans instead of appending duplicates', () => {
    let state = emptyConversation();
    state = reduceEvent(state, {
      method: 'turn/plan/updated',
      params: { turnId: 'a', plan: [{ step: 'Inspect', status: 'inProgress' }] },
    });
    state = reduceEvent(state, {
      method: 'turn/plan/updated',
      params: { turnId: 'a', plan: [{ step: 'Inspect', status: 'completed' }] },
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].steps?.[0].status).toBe('completed');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeItem } from './conversation';
import { agentStatusLabels, collectSubagents, conversationAgentStatus } from './subagents';
import { emptyConversation } from './types';

describe('subagent activity', () => {
  it('retains every target, initialization state and failure message without exposing duplicate IDs as prose', () => {
    const item = normalizeItem({
      type: 'collabAgentToolCall',
      id: 'spawn',
      tool: 'spawnAgent',
      receiverThreadIds: ['a', 'b'],
      prompt: 'Task',
      agentsStates: {
        a: { status: 'pendingInit' },
        b: { status: 'errored', message: 'quota reached' },
      },
    })!;
    expect(item.agents).toEqual([
      { threadId: 'a', status: 'pendingInit', prompt: 'Task', message: undefined },
      { threadId: 'b', status: 'errored', prompt: 'Task', message: 'quota reached' },
    ]);
    expect(item.detail).toBeUndefined();
    expect(item.steps).toBeUndefined();
  });
  it('deduplicates by thread, retains original assignment and updates completion', () => {
    const items = [
      normalizeItem({
        type: 'collabAgentToolCall',
        id: 'spawn',
        tool: 'spawnAgent',
        receiverThreadIds: ['a'],
        prompt: 'Original task',
      })!,
      normalizeItem({
        type: 'subAgentActivity',
        id: 'activity',
        kind: 'started',
        agentThreadId: 'a',
        agentPath: '/root/reviewer',
      })!,
      normalizeItem({
        type: 'collabAgentToolCall',
        id: 'wait',
        tool: 'wait',
        agentsStates: { a: { status: 'completed', message: 'Done' } },
      })!,
    ];
    expect(collectSubagents(items)).toEqual([
      {
        threadId: 'a',
        status: 'completed',
        name: '/root/reviewer',
        prompt: 'Original task',
        message: 'Done',
      },
    ]);
    expect(collectSubagents([])).toEqual([]);
  });
  it('covers every native agent status and separates interrupted, failed and complete', () => {
    for (const status of [
      'pendingInit',
      'running',
      'interrupted',
      'completed',
      'errored',
      'shutdown',
      'notFound',
    ])
      expect(agentStatusLabels[status]).toBeTruthy();
    expect(
      conversationAgentStatus({ ...emptyConversation(), lastTurnStatus: 'interrupted' }, 'running'),
    ).toBe('interrupted');
    expect(conversationAgentStatus({ ...emptyConversation(), error: 'failure' }, 'running')).toBe(
      'errored',
    );
    expect(conversationAgentStatus({ ...emptyConversation(), busy: true }, 'completed')).toBe(
      'running',
    );
  });
});

import { expect, it } from 'vitest';
import { findMessages } from './conversationSearch';

it('finds message bodies and returns the matching item for navigation', () => {
  const raw = [
    {
      id: 'user-1',
      type: 'userMessage',
      content: [{ type: 'text', text: 'Fix the configuration parser' }],
    },
    { id: 'assistant-1', type: 'agentMessage', text: 'The parser now preserves comments.' },
  ];
  expect(findMessages('task', raw, 'parser', 10)).toEqual([
    { taskId: 'task', itemId: 'user-1', snippet: 'Fix the configuration parser' },
    { taskId: 'task', itemId: 'assistant-1', snippet: 'The parser now preserves comments.' },
  ]);
  expect(findMessages('task', raw, 'parser', 1)).toHaveLength(1);
  expect(findMessages('task', raw, 'x', 10)).toEqual([]);
});

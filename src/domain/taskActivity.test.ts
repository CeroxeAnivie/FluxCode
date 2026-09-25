import { describe, expect, it } from 'vitest';
import { taskActivity } from './taskActivity';
import { emptyConversation, type Catalog } from './types';
import type { QueuedMessage } from './queuedMessage';

const catalog: Catalog = {
  version: 1,
  projects: [{ id: 'p', name: '项目', path: 'D:/project' }],
  tasks: ['running', 'input', 'queued', 'paused', 'failed', 'completed', 'idle', 'archived'].map(
    (id, index) => ({
      id,
      title: id,
      projectId: 'p',
      updatedAt: index,
      archived: id === 'archived',
    }),
  ),
};
const queued = (threadId: string, status: QueuedMessage['status']): QueuedMessage => ({
  id: threadId,
  threadId,
  text: 'message',
  selection: { model: 'fixture', effort: 'off' },
  attachments: [],
  status,
});

describe('task activity', () => {
  it('orders actionable statuses, excludes archived tasks and preserves task ownership', () => {
    const rows = taskActivity(
      catalog,
      {
        running: { ...emptyConversation(), busy: true, turnId: 'turn-r' },
        input: { ...emptyConversation(), busy: true, turnId: 'turn-i' },
        failed: { ...emptyConversation(), lastTurnStatus: 'failed' },
        completed: { ...emptyConversation(), lastTurnStatus: 'completed' },
      },
      [queued('queued', 'waiting'), queued('paused', 'paused')],
      new Set(['input']),
    );
    expect(rows.map((row) => row.status)).toEqual([
      'input',
      'failed',
      'running',
      'queued',
      'paused',
      'completed',
      'idle',
    ]);
    expect(rows.filter((row) => row.canStop).map((row) => row.task.id)).toEqual([
      'input',
      'running',
    ]);
    expect(rows.find((row) => row.task.id === 'queued')).toMatchObject({
      queuedCount: 1,
      project: '项目',
      canStop: false,
    });
  });
  it('handles empty catalogs, missing projects, interrupted turns and failed queued work', () => {
    expect(taskActivity({ version: 1, projects: [], tasks: [] }, {}, [], new Set())).toEqual([]);
    const rows = taskActivity(
      { ...catalog, projects: [] },
      {
        idle: { ...emptyConversation(), lastTurnStatus: 'interrupted' },
      },
      [queued('failed', 'failed')],
      new Set(),
    );
    expect(rows[0]).toMatchObject({ status: 'failed', project: '' });
    expect(rows.find((row) => row.task.id === 'idle')?.status).toBe('idle');
    expect(rows.every((row) => !row.canStop)).toBe(true);
  });
});

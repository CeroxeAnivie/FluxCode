import type { Catalog, Conversation } from './types';
import type { QueuedMessage } from './queuedMessage';

export type ActivityStatus =
  'running' | 'input' | 'queued' | 'paused' | 'failed' | 'completed' | 'idle';
export function taskActivity(
  catalog: Catalog,
  conversations: Record<string, Conversation>,
  queue: QueuedMessage[],
  waiting: ReadonlySet<string>,
) {
  const priority: Record<ActivityStatus, number> = {
    input: 0,
    failed: 1,
    running: 2,
    queued: 3,
    paused: 4,
    completed: 5,
    idle: 6,
  };
  return catalog.tasks
    .filter((task) => !task.archived)
    .map((task) => {
      const conversation = conversations[task.id];
      const pending = queue.filter((item) => item.threadId === task.id);
      const status: ActivityStatus = waiting.has(task.id)
        ? 'input'
        : conversation?.busy
          ? 'running'
          : conversation?.error ||
              conversation?.lastTurnStatus === 'failed' ||
              pending.some((item) => item.status === 'failed')
            ? 'failed'
            : pending.some((item) => item.status === 'waiting' || item.status === 'sending')
              ? 'queued'
              : pending.length
                ? 'paused'
                : conversation?.lastTurnStatus === 'completed'
                  ? 'completed'
                  : 'idle';
      return {
        task,
        status,
        queuedCount: pending.length,
        canStop: !!conversation?.busy && !!conversation.turnId,
        project: catalog.projects.find((project) => project.id === task.projectId)?.name ?? '',
      };
    })
    .sort(
      (left, right) =>
        priority[left.status] - priority[right.status] ||
        right.task.updatedAt - left.task.updatedAt,
    );
}

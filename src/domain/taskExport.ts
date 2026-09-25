import type { Conversation, Task } from './types';
export function exportTask(
  task: Task,
  conversation: Conversation,
  format: 'markdown' | 'json',
): string {
  if (format === 'json')
    return JSON.stringify(
      {
        schemaVersion: 1,
        task: {
          id: task.id,
          title: task.title,
          selection: task.selection,
          forkedFrom: task.forkedFrom,
        },
        messages: conversation.items,
      },
      null,
      2,
    );
  return (
    '# ' +
    task.title.replace(/[\r\n]/g, ' ') +
    '\n\n' +
    conversation.items
      .map((item) => {
        const text = item.text + (item.detail ? '\n\n' + item.detail : '');
        const fence = '`'.repeat(
          Math.max(3, ...(text.match(/`+/g) ?? []).map((v) => v.length + 1)),
        );
        return `## ${item.kind}\n\n${fence}text\n${text}\n${fence}`;
      })
      .join('\n\n') +
    '\n'
  );
}

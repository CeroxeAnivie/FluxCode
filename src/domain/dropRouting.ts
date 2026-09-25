import type { Attachment } from './attachments';

export function routeDroppedItems(
  items: Pick<Attachment, 'path' | 'kind'>[],
  hasProject: boolean,
): { projectPath: string | null; attachments: Pick<Attachment, 'path' | 'kind'>[] } {
  if (!hasProject && items.length === 1 && items[0].kind === 'directory') {
    return { projectPath: items[0].path, attachments: [] };
  }
  return { projectPath: null, attachments: items };
}

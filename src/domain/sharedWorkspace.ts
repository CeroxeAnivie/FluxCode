import type { Catalog, Conversation, Task } from './types';

// Windows project paths are canonicalized by the host when opened. Normalize
// separators and case here for display comparisons; this is not a security gate.
const comparablePath = (path: string) =>
  path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

export function sharedWorkspaceTasks(
  catalog: Catalog,
  conversations: Record<string, Conversation>,
  projectId: string | null,
  taskId: string | null,
): Task[] {
  const project = catalog.projects.find((item) => item.id === projectId);
  if (!project || project.imported) return [];
  const root = comparablePath(project.path);
  const overlapping = new Set(
    catalog.projects
      .filter((candidate) => {
        if (candidate.imported) return false;
        const path = comparablePath(candidate.path);
        return path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`);
      })
      .map((candidate) => candidate.id),
  );
  return catalog.tasks.filter(
    (task) => task.id !== taskId && overlapping.has(task.projectId) && conversations[task.id]?.busy,
  );
}

export interface Attachment {
  id: string;
  kind: 'file' | 'directory' | 'image';
  path: string;
  name: string;
}
export function mergeAttachmentPaths(
  existing: Attachment[],
  additions: Pick<Attachment, 'path' | 'kind'>[],
  newId: () => string = () => crypto.randomUUID(),
): Attachment[] {
  const seen = new Set(existing.map((item) => item.path.replaceAll('/', '\\').toLowerCase()));
  const unique = additions.filter((item) => {
    const key = item.path.replaceAll('/', '\\').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const next = [
    ...existing,
    ...unique.map((item) => ({
      id: newId(),
      path: item.path,
      kind: item.kind,
      name:
        item.path
          .replace(/[/\\]+$/, '')
          .split(/[/\\]/)
          .at(-1) ?? item.path,
    })),
  ];
  validateAttachments(next);
  return next;
}
export function validateAttachments(items: Attachment[]): void {
  if (!Array.isArray(items) || items.length > 20) throw new Error('最多添加 20 个上下文引用。');
  if (
    items.some(
      (i) =>
        !i ||
        typeof i.id !== 'string' ||
        typeof i.path !== 'string' ||
        typeof i.name !== 'string' ||
        !['file', 'directory', 'image'].includes(i.kind) ||
        !i.path ||
        i.path.length > 4096 ||
        !i.name,
    )
  )
    throw new Error('Invalid context attachment');
}

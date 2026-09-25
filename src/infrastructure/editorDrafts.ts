import { readDurable, writeDurable } from './durableStorage';
export interface EditorDraft {
  base: string;
  text: string;
  updatedAt: number;
}
const KEY = 'fluxcode.editor-drafts.v1';
function parse(raw: string | null): Record<string, EditorDraft> {
  if (!raw) return {};
  if (raw.length > 4_000_000) throw new Error('Editor draft storage exceeds limit');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid editor drafts');
  for (const item of Object.values(value)) {
    const d = item as EditorDraft;
    if (
      !d ||
      typeof d.base !== 'string' ||
      typeof d.text !== 'string' ||
      typeof d.updatedAt !== 'number' ||
      !Number.isFinite(d.updatedAt)
    )
      throw new Error('Invalid editor draft');
  }
  return value as Record<string, EditorDraft>;
}
const identity = (root: string, path: string) => JSON.stringify([root, path]);
export function hasEditorDrafts(storage: Storage = localStorage): boolean {
  return Object.keys(parse(storage.getItem(KEY))).length > 0;
}
export function loadEditorDraft(root: string, path: string) {
  return readDurable(KEY, parse)[identity(root, path)];
}
export function saveEditorDraft(root: string, path: string, draft: EditorDraft | null) {
  const drafts = readDurable(KEY, parse);
  const id = identity(root, path);
  if (draft) drafts[id] = draft;
  else delete drafts[id];
  const raw = JSON.stringify(drafts);
  if (raw.length > 4_000_000)
    throw new Error('Editor drafts are full. Save or discard another open edit.');
  writeDurable(KEY, drafts, parse);
}

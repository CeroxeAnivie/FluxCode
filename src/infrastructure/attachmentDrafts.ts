import { validateAttachments, type Attachment } from '../domain/attachments';
import { scheduleUiStateMirror } from './uiStateMirror';
const KEY = 'fluxcode.attachments.v1';
export function loadAttachmentDrafts(): Record<string, Attachment[]> {
  const raw = localStorage.getItem(KEY);
  if (!raw) return {};
  if (raw.length > 1_000_000) throw new Error('Attachment metadata limit exceeded');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid attachment storage');
  for (const items of Object.values(parsed)) {
    if (!Array.isArray(items)) throw new Error('Invalid attachments');
    validateAttachments(items);
  }
  return parsed as Record<string, Attachment[]>;
}
export function saveAttachmentDrafts(value: Record<string, Attachment[]>) {
  const raw = JSON.stringify(value);
  if (raw.length > 1_000_000) throw new Error('Attachment metadata limit exceeded');
  localStorage.setItem(KEY, raw);
  scheduleUiStateMirror();
}

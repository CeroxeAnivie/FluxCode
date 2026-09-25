/** Keep the last validated generation before replacing local workspace metadata. */
import { scheduleUiStateMirror } from './uiStateMirror';
export function readDurable<T>(
  key: string,
  parse: (raw: string | null) => T,
  storage: Storage = localStorage,
): T {
  const raw = storage.getItem(key);
  try {
    return parse(raw);
  } catch (original) {
    const backup = storage.getItem(`${key}.backup`);
    if (!backup) throw original;
    const recovered = parse(backup);
    // Preserve corrupt input for diagnosis; never silently discard the original.
    storage.setItem(`${key}.recovery`, raw ?? '');
    storage.setItem(key, backup);
    if (typeof localStorage !== 'undefined' && storage === localStorage) scheduleUiStateMirror();
    return recovered;
  }
}
export function writeDurable<T>(
  key: string,
  value: T,
  parse: (raw: string | null) => T,
  storage: Storage = localStorage,
) {
  const next = JSON.stringify(value);
  parse(next);
  const previous = storage.getItem(key);
  if (previous === next) return;
  if (previous !== null) {
    parse(previous);
    storage.setItem(`${key}.backup`, previous);
  }
  storage.setItem(key, next);
  if (typeof localStorage !== 'undefined' && storage === localStorage) scheduleUiStateMirror();
}

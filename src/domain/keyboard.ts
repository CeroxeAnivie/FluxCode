export interface InputKey {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const COMPOSITION_ENTER_GUARD_MS = 100;

export function isImeCommitKey(event: InputKey, compositionEndedAt: number, now: number): boolean {
  return (
    !!event.isComposing ||
    event.keyCode === 229 ||
    (compositionEndedAt > 0 && now - compositionEndedAt < COMPOSITION_ENTER_GUARD_MS)
  );
}

export function shouldSubmitOnEnter(
  event: InputKey,
  compositionEndedAt: number,
  now: number,
): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !isImeCommitKey(event, compositionEndedAt, now)
  );
}

export function shortcutBelongsToEditor(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [role="textbox"], .cm-editor, .xterm')) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

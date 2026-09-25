import { describe, expect, it } from 'vitest';
import { isImeCommitKey, shouldSubmitOnEnter } from './keyboard';

describe('Enter in the composer', () => {
  it('sends plain Enter after composition has settled', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter' }, 500, 700)).toBe(true);
  });

  it('keeps Shift+Enter and modified Enter in the editor', () => {
    for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(shouldSubmitOnEnter({ key: 'Enter', [modifier]: true }, 0, 700)).toBe(false);
    }
  });

  it('ignores Windows IME candidate and composition commit Enter events', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', isComposing: true }, 0, 700)).toBe(false);
    expect(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 }, 0, 700)).toBe(false);
    expect(shouldSubmitOnEnter({ key: 'Enter' }, 650, 700)).toBe(false);
    expect(isImeCommitKey({ key: 'Enter' }, 650, 700)).toBe(true);
    expect(shouldSubmitOnEnter({ key: 'Enter' }, 650, 750)).toBe(true);
  });
});

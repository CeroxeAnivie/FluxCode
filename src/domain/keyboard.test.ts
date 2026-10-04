import { describe, expect, it } from 'vitest';
import { isImeCommitKey, shouldQueueOnEnter, shouldSubmitOnEnter } from './keyboard';

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

it('Ctrl+Enter queues only intentional key presses outside IME composition', () => {
  expect(shouldQueueOnEnter({ key: 'Enter', ctrlKey: true }, 0, 700)).toBe(true);
  for (const modifier of ['repeat', 'shiftKey', 'altKey', 'metaKey', 'isComposing'] as const) {
    expect(shouldQueueOnEnter({ key: 'Enter', ctrlKey: true, [modifier]: true }, 0, 700)).toBe(
      false,
    );
  }
  expect(shouldQueueOnEnter({ key: 'Enter', ctrlKey: true, keyCode: 229 }, 0, 700)).toBe(false);
  expect(shouldQueueOnEnter({ key: 'Enter', ctrlKey: true }, 650, 700)).toBe(false);
  expect(shouldQueueOnEnter({ key: 'Enter' }, 0, 700)).toBe(false);
});

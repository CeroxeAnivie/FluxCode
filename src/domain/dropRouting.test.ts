import { expect, it } from 'vitest';
import { routeDroppedItems } from './dropRouting';

it('opens a single directory as a project before one has been selected', () => {
  expect(routeDroppedItems([{ path: 'C:\\work', kind: 'directory' }], false)).toEqual({
    projectPath: 'C:\\work',
    attachments: [],
  });
});

it('keeps mixed or existing-project drops as context attachments', () => {
  const items = [
    { path: 'C:\\work', kind: 'directory' as const },
    { path: 'C:\\notes.txt', kind: 'file' as const },
  ];
  expect(routeDroppedItems(items, false)).toEqual({ projectPath: null, attachments: items });
  expect(routeDroppedItems(items.slice(0, 1), true)).toEqual({
    projectPath: null,
    attachments: items.slice(0, 1),
  });
});

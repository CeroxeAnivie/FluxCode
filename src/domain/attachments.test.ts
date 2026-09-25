import { expect, it } from 'vitest';
import { mergeAttachmentPaths, type Attachment } from './attachments';

const attachment = (id: string): Attachment => ({
  id,
  path: `C:\\work\\${id}.txt`,
  name: `${id}.txt`,
  kind: 'file',
});

it('deduplicates a Windows drag batch without replacing existing references', () => {
  const existing = [attachment('a')];
  const merged = mergeAttachmentPaths(
    existing,
    [
      { path: 'c:/work/A.txt', kind: 'file' },
      { path: 'C:\\work\\b.txt', kind: 'file' },
      { path: 'C:\\work\\B.txt', kind: 'file' },
    ],
    () => 'new-id',
  );
  expect(merged).toEqual([
    existing[0],
    { id: 'new-id', path: 'C:\\work\\b.txt', name: 'b.txt', kind: 'file' },
  ]);
});

it('rejects the entire drag batch when it would exceed the reference limit', () => {
  const existing = Array.from({ length: 19 }, (_, index) => attachment(String(index)));
  const additions = [
    { path: 'C:\\work\\extra-a.txt', kind: 'file' as const },
    { path: 'C:\\work\\extra-b.txt', kind: 'file' as const },
  ];
  expect(() => mergeAttachmentPaths(existing, additions, () => 'new-id')).toThrow('最多添加 20 个');
  expect(existing).toHaveLength(19);
});

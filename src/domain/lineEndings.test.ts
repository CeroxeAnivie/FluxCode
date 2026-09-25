import { expect, it } from 'vitest';
import { preserveLineEndings } from './lineEndings';
it('preserves Windows endings after pasted text and does not add a final newline', () => {
  expect(preserveLineEndings('a\nb\n', 'old\r\n')).toBe('a\r\nb\r\n');
  expect(preserveLineEndings('a\nb', 'old\r\n')).toBe('a\r\nb');
});
it('retains LF and handles files without an existing newline', () => {
  expect(preserveLineEndings('a\r\nb', 'old\n')).toBe('a\nb');
  expect(preserveLineEndings('a\nb', '')).toBe('a\nb');
});

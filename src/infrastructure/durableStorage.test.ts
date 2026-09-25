import { expect, it } from 'vitest';
import { readDurable, writeDurable } from './durableStorage';
function store() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as Storage;
}
const parse = (raw: string | null) => {
  const value = JSON.parse(raw ?? '[]') as unknown;
  if (!Array.isArray(value)) throw new Error('Invalid');
  return value;
};
it('recovers the previous valid generation and preserves damaged input', () => {
  const storage = store();
  writeDurable('key', [1], parse, storage);
  writeDurable('key', [2], parse, storage);
  storage.setItem('key', 'broken');
  expect(readDurable('key', parse, storage)).toEqual([1]);
  expect(storage.getItem('key.recovery')).toBe('broken');
});
it('does not replace invalid records or hide unrecoverable corruption', () => {
  const storage = store();
  storage.setItem('key', 'broken');
  expect(() => readDurable('key', parse, storage)).toThrow();
  expect(() => writeDurable('key', [2], parse, storage)).toThrow();
  expect(storage.getItem('key')).toBe('broken');
});

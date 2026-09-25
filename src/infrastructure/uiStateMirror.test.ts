import { expect, it } from 'vitest';
import { UiStateMirror, captureUiState, type UiStateSnapshot } from './uiStateMirror';

function storage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  } as Storage;
}

const snapshot = (generation: number, value: string) => ({
  version: 1 as const,
  generation,
  values: { 'fluxcode.catalog.v1': value },
});

it('hydrates missing WebView data from the application directory before mounting', async () => {
  const local = storage();
  const native = {
    load: async () => snapshot(7, 'saved'),
    save: async () => {
      throw new Error('unexpected save');
    },
    restore: async () => {
      throw new Error('unexpected restore');
    },
  };
  const mirror = new UiStateMirror(local, native, () => {});
  await mirror.initialize();
  expect(captureUiState(local)).toEqual(snapshot(7, 'saved').values);
  expect(local.getItem('__fluxcode.ui-mirror-generation.v1')).toBe('7');
});

it('imports legacy local data once and preserves unflushed newer data', async () => {
  const local = storage({ 'fluxcode.catalog.v1': 'legacy' });
  let saved: UiStateSnapshot = snapshot(1, 'legacy');
  const generations: Array<number | null> = [];
  const native = {
    load: async () => (generations.length ? saved : null),
    save: async (expected: number | null, values: Record<string, string>) => {
      generations.push(expected);
      saved = { version: 1 as const, generation: (expected ?? 0) + 1, values };
      return saved;
    },
    restore: async () => saved,
  };
  const first = new UiStateMirror(local, native, () => {});
  await first.initialize();
  expect(generations).toEqual([null]);
  local.setItem('fluxcode.catalog.v1', 'newer local edit');
  local.setItem('__fluxcode.ui-mirror-dirty.v1', '1');
  const reopened = new UiStateMirror(local, native, () => {});
  await reopened.initialize();
  expect(generations).toEqual([null, 1]);
  expect(saved.values['fluxcode.catalog.v1']).toBe('newer local edit');
});

it('never replaces a healthy native index with a partially empty WebView profile', async () => {
  const local = storage({
    'fluxcode.queue.v1': '[]',
    '__fluxcode.ui-mirror-generation.v1': '5',
  });
  const mirror = new UiStateMirror(
    local,
    {
      load: async () => snapshot(5, 'saved catalog'),
      save: async () => {
        throw new Error('must not overwrite the mirror');
      },
      restore: async () => snapshot(6, 'restored'),
    },
    () => {},
  );
  await mirror.initialize();
  expect(captureUiState(local)).toEqual(snapshot(5, 'saved catalog').values);
});

it('serializes edits that arrive during a native write and flushes the final state', async () => {
  const local = storage();
  let release: (() => void) | undefined;
  const firstWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: string[] = [];
  const mirror = new UiStateMirror(
    local,
    {
      load: async () => null,
      save: async (generation, values) => {
        seen.push(values['fluxcode.catalog.v1']);
        if (seen.length === 1) await firstWrite;
        return { version: 1, generation: (generation ?? 0) + 1, values };
      },
      restore: async () => snapshot(1, 'restored'),
    },
    () => {},
  );
  await mirror.initialize();
  local.setItem('fluxcode.catalog.v1', 'first');
  mirror.changed();
  const flushing = mirror.flush();
  await Promise.resolve();
  local.setItem('fluxcode.catalog.v1', 'second');
  mirror.changed();
  release!();
  await flushing;
  expect(seen).toEqual(['first', 'second']);
});

it('commits confirmed backup state even when the old mirror cannot load', async () => {
  const local = storage({ 'fluxcode.catalog.v1': 'old' });
  let restoreCalls = 0;
  const mirror = new UiStateMirror(
    local,
    {
      load: async () => {
        throw new Error('corrupt mirror');
      },
      save: async () => {
        throw new Error('unexpected save');
      },
      restore: async (values) => {
        restoreCalls++;
        return { version: 1, generation: 8, values };
      },
    },
    () => {},
  );
  await mirror.initialize({ 'fluxcode.catalog.v1': 'restored' });
  expect(restoreCalls).toBe(1);
  expect(local.getItem('fluxcode.catalog.v1')).toBe('restored');
});

it('reports failed persistence and keeps the local edit available for retry', async () => {
  const local = storage();
  let fail = true;
  const errors: unknown[] = [];
  const mirror = new UiStateMirror(
    local,
    {
      load: async () => null,
      save: async (generation, values) => {
        if (fail) throw new Error('disk full');
        return { version: 1, generation: (generation ?? 0) + 1, values };
      },
      restore: async () => snapshot(1, 'restored'),
    },
    (error) => errors.push(error),
  );
  await mirror.initialize();
  local.setItem('fluxcode.catalog.v1', 'keep');
  mirror.changed();
  await expect(mirror.flush()).rejects.toThrow('disk full');
  expect(errors).toHaveLength(1);
  expect(local.getItem('fluxcode.catalog.v1')).toBe('keep');
  fail = false;
  mirror.changed();
  await mirror.flush();
  expect(local.getItem('__fluxcode.ui-mirror-generation.v1')).toBe('1');
});

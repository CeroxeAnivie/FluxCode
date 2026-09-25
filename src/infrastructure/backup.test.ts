import { expect, it } from 'vitest';
import { applyUiState, captureUiState, restoreBlockers } from './backup';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

it('captures only application-owned keys and restores them without touching other storage', () => {
  const storage = memoryStorage();
  storage.setItem('fluxcode.catalog.v1', 'old');
  storage.setItem('unrelated', 'keep');
  expect(captureUiState(storage)).toEqual({ 'fluxcode.catalog.v1': 'old' });
  applyUiState({ 'fluxcode.queue.v1': 'new' }, storage);
  expect(captureUiState(storage)).toEqual({ 'fluxcode.queue.v1': 'new' });
  expect(storage.getItem('unrelated')).toBe('keep');
  expect(() => applyUiState({ unrelated: 'no' }, storage)).toThrow();
  expect(captureUiState(storage)).toEqual({ 'fluxcode.queue.v1': 'new' });
});

it('blocks restore while queued messages or file edits would be replaced', () => {
  const storage = memoryStorage();
  expect(restoreBlockers(storage)).toEqual([]);
  storage.setItem(
    'fluxcode.queue.v1',
    JSON.stringify([
      {
        id: 'q',
        threadId: 't',
        text: 'keep this',
        selection: { model: 'fixture', effort: 'off' },
        attachments: [],
        status: 'waiting',
      },
    ]),
  );
  storage.setItem(
    'fluxcode.editor-drafts.v1',
    JSON.stringify({ file: { base: 'old', text: 'new', updatedAt: 1 } }),
  );
  expect(restoreBlockers(storage)).toEqual([
    '仍有待发送消息，请先处理或移除队列后再恢复。',
    '仍有未保存的文件编辑，请先保存或放弃草稿后再恢复。',
  ]);
  storage.setItem('fluxcode.queue.v1', '[]');
  storage.setItem('fluxcode.editor-drafts.v1', '{}');
  expect(restoreBlockers(storage)).toEqual([]);
});

it('blocks restore when local queue or editor state cannot be read', () => {
  const storage = memoryStorage();
  storage.setItem('fluxcode.queue.v1', '{broken');
  storage.setItem('fluxcode.editor-drafts.v1', '[]');
  expect(restoreBlockers(storage)).toEqual([
    '待发送队列无法读取，请先修复本地队列数据。',
    '文件编辑草稿无法读取，请先修复本地草稿数据。',
  ]);
});

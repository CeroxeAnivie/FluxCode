import { describe, expect, it } from 'vitest';
import { planTaskImport, parseImportedHistory } from './taskImport';
import { findMessages } from './conversationSearch';
import type { Catalog } from './types';

const catalog: Catalog = {
  version: 1,
  projects: [],
  tasks: [
    { id: 'source-1', projectId: 'existing', title: 'Existing', archived: false, updatedAt: 1 },
  ],
};
const exportFile = JSON.stringify({
  schemaVersion: 1,
  exportedAt: '2026-09-24T00:00:00.000Z',
  entries: [
    {
      project: { name: 'Workspace', path: 'C:/work' },
      task: { id: 'source-1', title: 'Plan', updatedAt: 42 },
      messages: [{ id: 'message-1', kind: 'assistant', text: 'A unique imported answer' }],
    },
  ],
});

describe('versioned conversation import', () => {
  it('previews projects, task count, ID conflicts and duplicate imports', async () => {
    const first = await planTaskImport(exportFile, catalog);
    expect(first.projectCount).toBe(1);
    expect(first.entries).toHaveLength(1);
    expect(first.idConflictCount).toBe(1);
    const repeated = await planTaskImport(exportFile, {
      ...catalog,
      tasks: [
        ...catalog.tasks,
        {
          id: 'new-local-id',
          projectId: 'archive',
          title: 'Plan',
          updatedAt: 42,
          archived: false,
          imported: {
            fingerprint: first.entries[0].fingerprint,
            sourceId: 'source-1',
            sourceProject: 'Workspace',
          },
        },
      ],
    });
    expect(repeated.duplicateCount).toBe(1);
  });

  it('rejects unsupported versions, invalid records and excessive input', async () => {
    await expect(planTaskImport('{"schemaVersion":2,"entries":[]}', catalog)).rejects.toThrow();
    await expect(planTaskImport('{bad json', catalog)).rejects.toThrow('导入文件不是有效 JSON。');
    await expect(planTaskImport('{"schemaVersion":1,"entries":[]}', catalog)).rejects.toThrow();
    await expect(
      planTaskImport(exportFile.replace('assistant', 'unknown-kind'), catalog),
    ).rejects.toThrow();
    await expect(planTaskImport('x'.repeat(8_388_609), catalog)).rejects.toThrow();
  });

  it('restores imported messages and searches their text without engine RPC', () => {
    const items = parseImportedHistory(
      JSON.stringify({
        schemaVersion: 1,
        messages: [{ id: 'm', kind: 'assistant', text: 'Find me again' }],
      }),
    );
    expect(findMessages('local-id', items, 'me again', 10)[0]).toMatchObject({
      taskId: 'local-id',
      itemId: 'm',
    });
    expect(() => parseImportedHistory('{"schemaVersion":3,"messages":[]}')).toThrow();
  });
});

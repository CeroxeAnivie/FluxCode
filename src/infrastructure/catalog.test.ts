import { describe, expect, it } from 'vitest';
import { parseCatalog } from './catalog';

describe('catalog persistence boundary', () => {
  it('initializes only when storage is absent', () => {
    expect(parseCatalog(null).tasks).toEqual([]);
  });
  it('reports corruption rather than silently dropping user metadata', () => {
    expect(() => parseCatalog('broken')).toThrow();
    expect(() => parseCatalog('{"version":2,"projects":[],"tasks":[]}')).toThrow();
    expect(() => parseCatalog('{"version":1,"projects":[{}],"tasks":[]}')).toThrow();
  });
  it('preserves legacy tasks and distinguishes Off from native none', () => {
    const task = { id: 't', projectId: 'p', title: 'Task', updatedAt: 1, archived: false };
    for (const effort of ['off', 'none', 'high']) {
      const catalog = {
        version: 1,
        projects: [],
        tasks: [{ ...task, selection: { model: 'custom', effort } }],
      };
      expect(parseCatalog(JSON.stringify(catalog))).toEqual(catalog);
    }
    expect(
      parseCatalog(JSON.stringify({ version: 1, projects: [], tasks: [task] })).tasks[0].selection,
    ).toBeUndefined();
    expect(() =>
      parseCatalog(
        JSON.stringify({
          version: 1,
          projects: [],
          tasks: [{ ...task, selection: { model: 'x', effort: 'wrong' } }],
        }),
      ),
    ).toThrow();
  });
});

describe('workspace catalog compatibility', () => {
  const original = {
    version: 1,
    projects: [{ id: 'p', name: '旧项目', path: 'D:/project' }],
    tasks: [],
  };
  it('accepts existing catalogs and round-trips closed worktree ownership without dropping projects', () => {
    expect(parseCatalog(JSON.stringify(original))).toEqual(original);
    const next = {
      ...original,
      projects: [{ ...original.projects[0], closed: true, worktreeParentId: 'parent' }],
    };
    expect(parseCatalog(JSON.stringify(next))).toEqual(next);
  });
  it('rejects invalid closure and parent metadata instead of silently changing visibility', () => {
    for (const metadata of [{ closed: 'false' }, { worktreeParentId: 42 }])
      expect(() =>
        parseCatalog(
          JSON.stringify({ ...original, projects: [{ ...original.projects[0], ...metadata }] }),
        ),
      ).toThrow();
  });
});

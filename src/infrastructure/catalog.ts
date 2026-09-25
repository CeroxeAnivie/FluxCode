import type { Catalog } from '../domain/types';
import { isModelSelection } from '../domain/modelSelection';
import { readDurable, writeDurable } from './durableStorage';

const KEY = 'fluxcode.catalog.v1';
export const emptyCatalog = (): Catalog => ({ version: 1, projects: [], tasks: [] });

export function parseCatalog(json: string | null): Catalog {
  if (!json) return emptyCatalog();
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object') throw new Error('项目索引格式无效');
  const c = value as Catalog;
  if (c.version !== 1 || !Array.isArray(c.projects) || !Array.isArray(c.tasks))
    throw new Error('项目索引版本不受支持');
  if (
    (c.lastModel !== undefined &&
      (typeof c.lastModel !== 'string' || !c.lastModel.trim() || c.lastModel.length > 200)) ||
    !c.projects.every(
      (p) =>
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.path === 'string' &&
        (p.closed === undefined || typeof p.closed === 'boolean') &&
        (p.worktreeParentId === undefined || typeof p.worktreeParentId === 'string') &&
        (p.imported === undefined || typeof p.imported === 'boolean'),
    ) ||
    !c.tasks.every(
      (t) =>
        typeof t.id === 'string' &&
        typeof t.title === 'string' &&
        typeof t.projectId === 'string' &&
        typeof t.updatedAt === 'number' &&
        typeof t.archived === 'boolean' &&
        (t.pinned === undefined || typeof t.pinned === 'boolean') &&
        (t.forkedFrom === undefined || (typeof t.forkedFrom === 'string' && !!t.forkedFrom)) &&
        (t.selection === undefined || isModelSelection(t.selection)) &&
        (t.imported === undefined ||
          (typeof t.imported.fingerprint === 'string' &&
            /^[a-f0-9]{64}$/.test(t.imported.fingerprint) &&
            typeof t.imported.sourceId === 'string' &&
            !!t.imported.sourceId &&
            typeof t.imported.sourceProject === 'string' &&
            t.imported.sourceProject.length <= 200)),
    )
  )
    throw new Error('项目索引数据损坏');
  return c;
}

export const loadCatalog = (): Catalog => readDurable(KEY, parseCatalog);
export const saveCatalog = (catalog: Catalog): void => writeDurable(KEY, catalog, parseCatalog);

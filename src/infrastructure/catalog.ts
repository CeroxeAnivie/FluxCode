import type { Catalog } from '../domain/types';
import { isModelSelection } from '../domain/modelSelection';

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
      (p) => typeof p.id === 'string' && typeof p.name === 'string' && typeof p.path === 'string',
    ) ||
    !c.tasks.every(
      (t) =>
        typeof t.id === 'string' &&
        typeof t.title === 'string' &&
        typeof t.projectId === 'string' &&
        typeof t.updatedAt === 'number' &&
        typeof t.archived === 'boolean' &&
        (t.selection === undefined || isModelSelection(t.selection)),
    )
  )
    throw new Error('项目索引数据损坏');
  return c;
}

export const loadCatalog = (): Catalog => parseCatalog(localStorage.getItem(KEY));
export const saveCatalog = (catalog: Catalog): void =>
  localStorage.setItem(KEY, JSON.stringify(catalog));

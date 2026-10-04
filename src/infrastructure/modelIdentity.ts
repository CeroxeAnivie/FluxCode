import { isModelIdentity } from '../domain/modelIdentity';
import type { ModelIdentity } from '../domain/types';
import { readDurable, writeDurable } from './durableStorage';

const key = (threadId: string) => `fluxcode.turn-identities.${threadId}`;
function parse(raw: string | null): Record<string, ModelIdentity> {
  if (!raw) return {};
  if (raw.length > 8_000_000) throw new Error('模型来源记录超过大小上限');
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length > 10000 ||
    !Object.values(value).every(isModelIdentity)
  )
    throw new Error('模型来源记录格式无效');
  return value as Record<string, ModelIdentity>;
}
export const readTurnIdentities = (threadId: string) => readDurable(key(threadId), parse);
export function saveTurnIdentity(threadId: string, turnId: string, identity: ModelIdentity): void {
  const current = readTurnIdentities(threadId);
  if (Object.hasOwn(current, turnId)) return;
  writeDurable(key(threadId), { ...current, [turnId]: identity }, parse);
}

export function copyTurnIdentities(sourceId: string, targetId: string): void {
  const source = readTurnIdentities(sourceId);
  if (Object.keys(source).length) writeDurable(key(targetId), source, parse);
}

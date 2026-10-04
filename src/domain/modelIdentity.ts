import type { ModelIdentity } from './types';

export function isModelIdentity(value: unknown): value is ModelIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as ModelIdentity;
  return (
    typeof identity.model === 'string' && identity.model.length > 0 && identity.model.length <= 1024
  );
}

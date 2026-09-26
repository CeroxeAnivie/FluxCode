// Input is the unmodified models.json from the pinned Codex release.
// Never synthesize model capability metadata. Only remove implicit effort defaults.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readEngineRelease } from './lib/engine-release.mjs';

const source = process.argv[2];
if (!source)
  throw new Error('Usage: node scripts/prepare-model-catalog.mjs <pinned-upstream-models.json>');
const bytes = await readFile(source);
if (createHash('sha256').update(bytes).digest('hex') !== readEngineRelease().models_sha256) {
  throw new Error(
    'Upstream catalog digest differs from the engine release manifest; review the upgrade first',
  );
}
const catalog = JSON.parse(bytes.toString('utf8'));
if (!Array.isArray(catalog.models) || !catalog.models.length)
  throw new Error('Invalid upstream model catalog');
for (const model of catalog.models) {
  model.default_reasoning_level = null;
  model.supports_reasoning_effort_updates = false;
}
await writeFile(
  resolve(import.meta.dirname, '../config/engine-models.json'),
  JSON.stringify(catalog, null, 2) + '\n',
  'utf8',
);
console.log(`Upstream SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);

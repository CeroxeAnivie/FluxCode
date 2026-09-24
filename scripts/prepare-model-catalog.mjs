// Input is the unmodified models.json from the pinned Codex release.
// Never synthesize model capability metadata. Only remove implicit effort defaults.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-model-catalog.mjs <pinned-upstream-models.json>');
const bytes = await readFile(source);
if (createHash('sha256').update(bytes).digest('hex') !== '1892a933a420e79a30779ef5f1ce5b7dbc145464aa6fb1432106a9e9859981d3') {
  throw new Error('Upstream catalog digest differs from pinned rust-v0.156.1; review the engine upgrade first');
}
const catalog = JSON.parse(bytes.toString('utf8'));
if (!Array.isArray(catalog.models) || !catalog.models.length) throw new Error('Invalid upstream model catalog');
for (const model of catalog.models) {
  model.default_reasoning_level = null;
  model.supports_reasoning_effort_updates = false;
}
await writeFile(resolve(import.meta.dirname, '../config/engine-models.json'), JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log(`Upstream SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);

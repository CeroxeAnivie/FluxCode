import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const engine = await readFile(resolve(root, 'src-tauri/resources/engine/codex.exe'));
assert.equal(createHash('sha256').update(engine).digest('hex'), '70bcb05f9bf1a4e7306edd0cd1b57d02af3267ad02a34b26f45c8c4bb20a3301');
const installer = await readFile(resolve(root, 'src-tauri/target/release/nsis/x64/installer.nsi'), 'utf8');
for (const file of ['engine\\codex.exe', 'legal\\CODEX-LICENSE.txt', 'legal\\CODEX-NOTICE.txt', 'legal\\FLUXCODE-LICENSE.txt', 'legal\\THIRD-PARTY-NOTICES.txt', 'legal\\UPSTREAM-LICENSE-SUPPLEMENTS.txt', 'legal\\SOURCE-AVAILABILITY.txt', 'selectors-0.36.1.crate']) assert.ok(installer.includes(file), `Missing installer resource: ${file}`);
for (const file of await readdir(resolve(root, 'dist/assets'))) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(resolve(root, 'dist/assets', file), 'utf8');
  assert.ok(!source.includes('__FLUX_TEST_BRIDGE__'), 'Production JavaScript must not expose test transport');
  assert.ok(!source.includes('fixture-model'), 'Production JavaScript must not contain fixture model');
}
const setup = await readFile(resolve(root, 'src-tauri/target/release/bundle/nsis/FluxCode_0.1.0_x64-setup.exe'));
assert.equal(setup.subarray(0, 2).toString('ascii'), 'MZ');
console.log(JSON.stringify({ verified: true, installerBytes: setup.length, sha256: createHash('sha256').update(setup).digest('hex'), engineVersion: '0.156.1', productionTestTransport: false }, null, 2));

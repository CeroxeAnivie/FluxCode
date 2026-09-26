import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertPackagedExecutable } from './lib/release-binary.mjs';
import { readEngineRelease } from './lib/engine-release.mjs';

const root = resolve(import.meta.dirname, '..');
const release = readEngineRelease();
const engine = await readFile(resolve(root, 'src-tauri/resources/engine/codex.exe'));
assert.equal(createHash('sha256').update(engine).digest('hex'), release.engine_sha256);
const codeModeHost = await readFile(
  resolve(root, 'src-tauri/resources/engine/codex-code-mode-host.exe'),
);
assert.equal(createHash('sha256').update(codeModeHost).digest('hex'), release.code_mode_sha256);
for (const [name, digest] of [
  ['CODEX-LICENSE.txt', release.license_sha256],
  ['CODEX-NOTICE.txt', release.notice_sha256],
]) {
  const contents = await readFile(resolve(root, 'src-tauri/resources/legal', name));
  assert.equal(
    createHash('sha256').update(contents).digest('hex'),
    digest,
    `Unexpected ${name} content`,
  );
}
const installer = await readFile(
  resolve(root, 'src-tauri/target/release/nsis/x64/installer.nsi'),
  'utf8',
);
assert.ok(installer.includes('engine\\codex-code-mode-host.exe'), 'Missing bundled code-mode host');
for (const file of [
  'engine\\codex.exe',
  'legal\\CODEX-LICENSE.txt',
  'legal\\CODEX-NOTICE.txt',
  'legal\\FLUXCODE-LICENSE.txt',
  'legal\\THIRD-PARTY-NOTICES.txt',
  'legal\\UPSTREAM-LICENSE-SUPPLEMENTS.txt',
  'legal\\SOURCE-AVAILABILITY.txt',
  'legal\\ENGINE-THIRD-PARTY-NOTICES.txt',
  'legal\\ENGINE-LICENSE-SUPPLEMENTS.txt',
  'legal\\ENGINE-METADATA-LICENSES.txt',
  'legal\\ENGINE-NATIVE-NOTICES.txt',
  'legal\\ENGINE-SOURCE-AVAILABILITY.txt',
  'selectors-0.36.1.crate',
])
  assert.ok(installer.includes(file), `Missing installer resource: ${file}`);
const hooks = await readFile(resolve(root, 'src-tauri/nsis/installer-hooks.nsh'), 'utf8');
assert.match(
  installer,
  /!include\s+"[^"]*installer-hooks\.nsh"/,
  'Generated installer must include FluxCode uninstall hooks',
);
assert.match(
  installer,
  /!insertmacro NSIS_HOOK_POSTUNINSTALL/,
  'Generated uninstaller must call the data removal hook',
);
assert.match(
  installer,
  /!insertmacro MUI_LANGUAGE "SimpChinese"[\s\S]*!insertmacro MUI_LANGUAGE "English"/,
  'Installer languages must include Chinese and English',
);
assert.match(
  hooks,
  /\$DeleteAppDataCheckboxState = 1[\s\S]*\$UpdateMode <> 1[\s\S]*IfFileExists "\$INSTDIR\\data\\storage-layout\.toml"[\s\S]*GetFileAttributesW[\s\S]*0x400[\s\S]*RMDir \/r "\$INSTDIR\\data"/,
  'Explicit uninstall must protect application-owned data',
);
assert.ok(
  !/RMDir \/r "\$INSTDIR\\data"/.test(installer),
  'Generated installer must not unconditionally remove stored data',
);
for (const file of await readdir(resolve(root, 'dist/assets'))) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(resolve(root, 'dist/assets', file), 'utf8');
  assert.ok(
    !source.includes('__FLUX_TEST_BRIDGE__'),
    'Production JavaScript must not expose test transport',
  );
  assert.ok(
    !source.includes('fixture-model'),
    'Production JavaScript must not contain fixture model',
  );
}
const setupPath = resolve(
  root,
  'src-tauri/target/release/bundle/nsis/FluxCode_0.1.0_x64-setup.exe',
);
const setupStat = await stat(setupPath);
for (const sourcePath of [
  resolve(root, 'src-tauri/target/release/nsis/x64/installer.nsi'),
  resolve(root, 'src-tauri/nsis/installer-hooks.nsh'),
]) {
  assert.ok(
    setupStat.mtimeMs >= (await stat(sourcePath)).mtimeMs,
    `Installer predates ${sourcePath}`,
  );
}
const setup = await readFile(setupPath);
assert.equal(setup.subarray(0, 2).toString('ascii'), 'MZ');
await mkdir(resolve(root, 'work'), { recursive: true });
const extracted = await mkdtemp(resolve(root, 'work/release-verification-'));
const sevenZip =
  process.env.SEVENZIP_BIN ||
  resolve(process.env.ProgramFiles || 'C:/Program Files', '7-Zip/7z.exe');
execFileSync(
  sevenZip,
  ['x', setupPath, `-o${extracted}`, '-y', 'fluxcode.exe', 'engine/*', 'legal/*'],
  {
    windowsHide: true,
    timeout: 120000,
    stdio: 'pipe',
  },
);
assertPackagedExecutable(
  await readFile(resolve(extracted, 'fluxcode.exe')),
  await readFile(resolve(root, 'src-tauri/target/release/fluxcode.exe')),
);
let resourceCount = 0;
for (const directory of ['engine', 'legal']) {
  const sourceRoot = resolve(root, 'src-tauri/resources', directory);
  for (const name of await readdir(sourceRoot, { recursive: true })) {
    const sourceFile = resolve(sourceRoot, name);
    if (!(await stat(sourceFile)).isFile()) continue;
    const sourceBytes = await readFile(sourceFile);
    const packagedBytes = await readFile(resolve(extracted, directory, name));
    assert.equal(
      createHash('sha256').update(packagedBytes).digest('hex'),
      createHash('sha256').update(sourceBytes).digest('hex'),
      `Installer resource differs: ${directory}/${name}`,
    );
    resourceCount++;
  }
}
console.log(
  JSON.stringify(
    {
      verified: true,
      installerBytes: setup.length,
      sha256: createHash('sha256').update(setup).digest('hex'),
      engineVersion: release.version,
      productionTestTransport: false,
      executableContentMatches: true,
      verifiedResources: resourceCount,
      extractedEvidence: extracted,
    },
    null,
    2,
  ),
);

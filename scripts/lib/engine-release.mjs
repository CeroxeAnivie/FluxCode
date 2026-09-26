import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Python's standard TOML parser is also used by the pinned source build recipe.
export function readEngineRelease() {
  const path = fileURLToPath(new URL('../../config/engine-release.toml', import.meta.url));
  const result = execFileSync(
    process.env.PYTHON || 'python',
    [
      '-c',
      'import json,sys,tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], "rb"))))',
      path,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  const release = JSON.parse(result);
  for (const key of [
    'engine_sha256',
    'code_mode_sha256',
    'license_sha256',
    'notice_sha256',
    'models_sha256',
  ]) {
    if (!/^[a-f0-9]{64}$/.test(release[key]))
      throw new Error('Invalid engine release digest: ' + key);
  }
  if (!/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error('Invalid engine version');
  return release;
}

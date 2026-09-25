import assert from 'node:assert/strict';

/** Tauri patches exactly this marker in the packaged executable, then restores
 * the original file. All other bytes must match the current build. */
export function assertPackagedExecutable(packaged, built) {
  const prefix = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_');
  const normalized = Buffer.from(packaged);
  const offset = normalized.indexOf(prefix);
  assert.ok(offset >= 0, 'Packaged executable has no Tauri bundle marker');
  assert.equal(normalized.indexOf(prefix, offset + prefix.length), -1, 'Ambiguous bundle marker');
  const tag = offset + prefix.length;
  assert.equal(
    normalized.subarray(tag, tag + 3).toString('ascii'),
    'NSS',
    'Expected NSIS bundle marker',
  );
  assert.equal(
    built.subarray(offset, tag + 3).toString('ascii'),
    `${prefix.toString('ascii')}UNK`,
    'Unexpected build bundle marker',
  );
  normalized.write('UNK', tag, 3, 'ascii');
  assert.ok(normalized.equals(built), 'Packaged executable differs from the current build');
}

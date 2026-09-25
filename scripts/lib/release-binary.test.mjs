import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPackagedExecutable } from './release-binary.mjs';

const built = Buffer.from('header__TAURI_BUNDLE_TYPE_VAR_UNKbody');
const packaged = Buffer.from('header__TAURI_BUNDLE_TYPE_VAR_NSSbody');
test('accepts only the observed NSIS marker change without mutating input', () => {
  const before = Buffer.from(packaged);
  assertPackagedExecutable(packaged, built);
  assert.deepEqual(packaged, before);
});
test('rejects old code, truncation and added bytes even with a valid marker', () => {
  for (const value of [
    Buffer.from('other!__TAURI_BUNDLE_TYPE_VAR_NSSbody'),
    packaged.subarray(0, -1),
    Buffer.concat([packaged, Buffer.from('extra')]),
  ]) {
    assert.throws(() => assertPackagedExecutable(value, built));
  }
});
test('rejects missing, duplicate and unexpected bundle markers', () => {
  for (const value of [
    Buffer.from('no marker'),
    Buffer.concat([packaged, packaged]),
    built,
    Buffer.from('header__TAURI_BUNDLE_TYPE_VAR_MSIbody'),
  ]) {
    assert.throws(() => assertPackagedExecutable(value, built));
  }
});

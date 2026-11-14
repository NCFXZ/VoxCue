import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Give test launchers no production-parent privilege. Preserve all crypto,
// access migration and runtime checks; change one expected parent identifier in
// a temporary source copy only. The canonical source is never edited.
export async function writeCredentialFixtureSource(directory, kind, parentIdentifier) {
  assert.match(parentIdentifier, /^com\.voxcue\.test\.credentials\.[a-f0-9]{24}$/);
  const sources = {
    legacy: 'Credentials.mm',
    'vault-v11': 'CredentialsVaultV11.mm',
  };
  assert.ok(Object.hasOwn(sources, kind));
  const filename = sources[kind];
  const source = await readFile(new URL('../../native/' + filename, import.meta.url), 'utf8');
  const expected =
    kind === 'legacy'
      ? String.raw`(identifier \"com.voxcue.app\" or identifier \"com.voxcue.development\")`
      : 'hardenedIdentity(code, @"com.voxcue.app")';
  const replacement =
    kind === 'legacy'
      ? String.raw`identifier \"${parentIdentifier}\"`
      : `hardenedIdentity(code, @"${parentIdentifier}")`;
  const parts = source.split(expected);
  assert.equal(parts.length, 2, 'Exactly one expected production parent identity must be replaced');
  const file = path.join(directory, 'fixture-' + filename);
  await writeFile(file, parts.join(replacement), { flag: 'wx', mode: 0o600 });
  return file;
}

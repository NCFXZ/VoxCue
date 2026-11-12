import { afterEach, expect, it } from 'vitest';
import {
  mkdtemp,
  chmod,
  lstat,
  readFile,
  writeFile,
  unlink,
  symlink,
  link,
  rm,
} from 'node:fs/promises';
import { sign } from 'node:crypto';
import path from 'node:path';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { updateSigningKey } from '../../scripts/update-signing.mjs';
import { backupUpdateKey, restoreUpdateKey } from '../../scripts/update-key-backup.mjs';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(testRoot, 'synthetic-signing-'));
  roots.push(root);
  const options = {
    keyDirectory: path.join(root, 'private'),
    pinFile: path.join(root, 'public.json'),
  };
  const signing = await updateSigningKey({ ...options, create: true });
  return {
    root,
    options,
    signing,
    key: path.join(options.keyDirectory, 'ed25519.key'),
    backup: path.join(root, 'encrypted.json'),
  };
}
const password = 'Synthetic offline recovery passphrase 2026!';
it('restores the same synthetic identity, authenticates with the old public key and refuses overwrites', async () => {
  const f = await fixture();
  const challenge = Buffer.from('synthetic identity continuity');
  const original = sign(null, challenge, f.signing.key);
  await backupUpdateKey(f.backup, password, f.options);
  expect((await lstat(f.backup)).mode & 0o777).toBe(0o600);
  expect(await readFile(f.backup, 'utf8')).not.toContain((await readFile(f.key, 'utf8')).trim());
  await expect(backupUpdateKey(f.backup, password, f.options)).rejects.toMatchObject({
    code: 'EEXIST',
  });
  await expect(restoreUpdateKey(f.backup, password, f.options)).rejects.toThrow('overwrite');
  await unlink(f.key);
  await restoreUpdateKey(f.backup, password, f.options);
  const restored = await updateSigningKey(f.options);
  expect(restored.publicKey).toBe(f.signing.publicKey);
  expect(sign(null, challenge, restored.key)).toEqual(original);
  expect((await lstat(f.key)).mode & 0o777).toBe(0o600);
});
it.each(['password', 'tamper', 'identity'] as const)(
  'rejects %s without writing any restored private key',
  async (mode) => {
    const f = await fixture();
    await backupUpdateKey(f.backup, password, f.options);
    await unlink(f.key);
    if (mode === 'tamper') {
      const value = JSON.parse(await readFile(f.backup, 'utf8'));
      const encrypted = Buffer.from(value.ciphertext, 'base64');
      encrypted[0] ^= 1;
      value.ciphertext = encrypted.toString('base64');
      await writeFile(f.backup, JSON.stringify(value));
    }
    if (mode === 'identity') {
      const other = await fixture();
      f.options.pinFile = other.options.pinFile;
    }
    await expect(
      restoreUpdateKey(f.backup, mode === 'password' ? password + 'wrong' : password, f.options),
    ).rejects.toThrow();
    await expect(lstat(f.key)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
it.each(['directory', 'permissions', 'link', 'hardlink'] as const)(
  'rejects unsafe %s before using synthetic signing material',
  async (mode) => {
    const f = await fixture();
    const before = await readFile(f.key);
    if (mode === 'directory') await chmod(f.options.keyDirectory, 0o755);
    else if (mode === 'permissions') await chmod(f.key, 0o644);
    else if (mode === 'link') {
      await unlink(f.key);
      const target = path.join(f.root, 'seed');
      await writeFile(target, before, { mode: 0o600 });
      await symlink(target, f.key);
    } else await link(f.key, path.join(f.root, 'alias'));
    await expect(updateSigningKey(f.options)).rejects.toThrow(/private|redirected/);
    expect(await readFile(f.key)).toEqual(before);
  },
);

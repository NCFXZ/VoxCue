import assert from 'node:assert/strict';
import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Read-only verification for an explicitly authorized cache. Do not invoke
// ComponentService.status/download/remove on installed user model directories.
export async function verifyCachedComponent(directory, pkg) {
  const rootInfo = await lstat(directory);
  assert.ok(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'Unsafe model directory');
  const marker = path.join(directory, '.voxcue-component.json');
  const markerInfo = await lstat(marker);
  assert.ok(
    markerInfo.isFile() && !markerInfo.isSymbolicLink() && markerInfo.size <= 1024,
    'Invalid model marker',
  );
  assert.equal(
    JSON.parse(await readFile(marker, 'utf8')).sha256,
    pkg.sha256,
    'Model catalog mismatch',
  );
  const expected = new Map(pkg.files.map((file) => [file.path, file]));
  let count = 0;
  const visit = async (folder, relative = '') => {
    const info = await lstat(folder);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Unsafe model directory');
    for (const name of await readdir(folder)) {
      const file = path.join(folder, name);
      const rel = relative ? relative + '/' + name : name;
      const stat = await lstat(file);
      assert.ok(!stat.isSymbolicLink(), 'Model links are not accepted');
      if (stat.isDirectory()) {
        await visit(file, rel);
        continue;
      }
      const descriptor = expected.get(rel);
      assert.ok(
        stat.isFile() && descriptor && stat.size === descriptor.bytes,
        'Unexpected model file: ' + rel,
      );
      if (process.platform !== 'win32' && descriptor.mode & 0o111)
        assert.ok(stat.mode & 0o111, 'Missing executable mode: ' + rel);
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const hash = createHash('sha256');
      try {
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      } finally {
        await handle.close();
      }
      assert.equal(hash.digest('hex'), descriptor.sha256, 'Model checksum mismatch: ' + rel);
      count++;
    }
  };
  await visit(path.join(directory, 'files'));
  assert.equal(count, expected.size, 'Missing model files');
  return count;
}

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

assert.equal(process.platform, 'win32');
const version = '1.90.0';
const target = 'x86_64-pc-windows-gnu';
const root = path.resolve(import.meta.dirname, `../.tools/rust-${version}-gnu`);
const downloads = path.join(root, 'downloads');
await mkdir(downloads, { recursive: true });
const artifacts = [
  ['rustc', 'rustc', '925e67ef4684861eb301d123a45292a63a0afba49060b60e3264f73c7f9cc1ec'],
  ['rust-std', `rust-std-${target}`, 'd82b3240908390cef1ddb88d2d922fa6d5e8abb6e6ef1d47948ec503ba694bf5'],
  ['rust-mingw', 'rust-mingw', '3254c05b7a7f8edc915a78b11dafd5395f9bc94b2c6a24016294470190e1f77c'],
  ['cargo', 'cargo', 'b7806005e41b7733b1f4ec9111b43c2590e1535a7713644660346161cdc71c46'],
];
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
for (const [name, component, expected] of artifacts) {
  const packageName = `${name}-${version}-${target}`;
  const filename = packageName + '.tar.xz';
  const archive = path.join(downloads, filename);
  let valid = false;
  try {
    valid = await digest(archive) === expected;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!valid) {
    const url = `https://static.rust-lang.org/dist/${filename}`;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(180000) });
    assert.ok(response.ok && response.body, `Official Rust download failed: ${response.status}`);
    const partial = archive + '.' + randomUUID() + '.partial';
    let bytes = 0;
    const bounded = new Transform({
      transform(chunk, _encoding, next) {
        bytes += chunk.length;
        next(bytes > 200 * 1024 * 1024 ? Error('Rust archive exceeds fixed download bound') : null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body), bounded, createWriteStream(partial, { flags: 'wx' }));
      assert.equal(await digest(partial), expected, `Official Rust SHA-256 mismatch: ${filename}`);
      await rename(partial, archive);
    } finally {
      await rm(partial, { force: true });
    }
  }
  // Authenticate cached archives too; never trust a previously extracted binary.
  assert.equal(await digest(archive), expected, `Cached Rust SHA-256 mismatch: ${filename}`);
  const result = spawnSync('tar.exe', [
    '-xf', archive, '-C', root, '--strip-components=2', `${packageName}/${component}`,
  ], { stdio: 'inherit', windowsHide: true, timeout: 120000 });
  assert.equal(result.status, 0, `Rust extraction failed: ${filename}`);
  console.log(`Verified and restored ${packageName}`);
}

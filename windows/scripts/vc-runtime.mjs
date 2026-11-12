import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const metadata = JSON.parse(await readFile(path.join(root, 'vc-runtime.json'), 'utf8'));
export const vcRuntimeVersion = metadata.version;
export const vcRuntimeFiles = Object.freeze(
  metadata.files.map((file) => Object.freeze({ ...file })),
);
export const vcRuntimeLicense = Object.freeze({
  name: metadata.license.name,
  sha256: metadata.license.sha256,
});
const cache = path.join(root, '.cache/vc-runtime');
const directory = path.join(cache, `${metadata.version}-x64`);
const source = metadata.source;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fileMatches(file, expected) {
  try {
    const stat = await lstat(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Redirected VC runtime file');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === expected;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
function verifyDll(bytes, file) {
  assert.equal(digest(bytes), file.sha256, `VC runtime SHA-256 mismatch: ${file.name}`);
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ', `Invalid VC runtime PE: ${file.name}`);
  const pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString('ascii', pe, pe + 4), 'PE\0\0');
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, `VC runtime must be x64: ${file.name}`);
}
async function download(archive) {
  if (await fileMatches(archive, source.sha256)) return;
  const response = await fetch(source.url, {
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
  });
  assert.ok(
    response.ok && response.body,
    `Official Microsoft CRT download failed: ${response.status}`,
  );
  const partial = path.join(cache, `${randomUUID()}.partial`);
  let size = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, next) {
          size += chunk.length;
          next(
            size > source.size ? Error('Microsoft CRT download exceeds fixed size') : null,
            chunk,
          );
        },
      }),
      createWriteStream(partial, { flags: 'wx' }),
    );
    assert.equal(size, source.size, 'Microsoft CRT download size mismatch');
    assert.ok(await fileMatches(partial, source.sha256), 'Microsoft CRT download SHA-256 mismatch');
    await rename(partial, archive);
  } finally {
    await rm(partial, { force: true });
  }
}

/** Authenticate fixed public app-local CRT files; never execute a redistributable or MSI. */
export async function prepareVcRuntime() {
  assert.equal(process.platform, 'win32');
  await mkdir(cache, { recursive: true });
  assert.equal(await realpath(cache), cache, 'Redirected VC runtime cache');
  const allFiles = [...vcRuntimeFiles, vcRuntimeLicense];
  if (
    await Promise.all(
      allFiles.map((file) => fileMatches(path.join(directory, file.name), file.sha256)),
    ).then((matches) => matches.every(Boolean))
  ) {
    assert.equal(await realpath(directory), directory, 'Redirected VC runtime directory');
    return { directory, files: vcRuntimeFiles, license: vcRuntimeLicense };
  }
  const archive = path.join(cache, 'Microsoft.VisualCpp.CRT.Redist.X64.vsix');
  await download(archive);
  const zip = new (require('adm-zip'))(archive);
  const executable = zip.readFile(source.entry);
  assert.ok(
    executable && digest(executable) === source.executableSha256,
    'Microsoft CRT redist SHA-256 mismatch',
  );
  const cabinet = executable.subarray(
    source.cabinetOffset,
    source.cabinetOffset + source.cabinetSize,
  );
  assert.equal(digest(cabinet), source.cabinetSha256, 'Microsoft CRT cabinet SHA-256 mismatch');
  const staging = path.join(cache, `.stage-${randomUUID()}`);
  await mkdir(staging);
  try {
    const redistFile = path.join(staging, 'redist.exe');
    const cabinetFile = path.join(staging, 'attached.cab');
    const runtimeFile = path.join(staging, 'runtime.cab');
    await writeFile(redistFile, executable, { flag: 'wx' });
    await writeFile(cabinetFile, cabinet, { flag: 'wx' });
    process.env.ELECTRON_BUILDER_CACHE = path.join(root, '.cache/electron-builder');
    const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
    const seven = await getPath7za();
    const extract = (archive, entry) =>
      execFileSync(seven, ['e', '-so', '-bd', archive, entry], {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
      });
    const runtime = extract(cabinetFile, source.runtimeEntry);
    assert.equal(
      digest(runtime),
      source.runtimeSha256,
      'Microsoft CRT runtime cabinet SHA-256 mismatch',
    );
    await writeFile(runtimeFile, runtime, { flag: 'wx' });
    await mkdir(directory, { recursive: true });
    assert.equal(await realpath(directory), directory, 'Redirected VC runtime directory');
    for (const file of vcRuntimeFiles) {
      const bytes = extract(runtimeFile, file.name + '_amd64');
      verifyDll(bytes, file);
      const target = path.join(directory, file.name);
      const partial = path.join(staging, file.name);
      await writeFile(partial, bytes, { flag: 'wx' });
      await rename(partial, target);
    }
    const license = extract(redistFile, metadata.license.entry);
    assert.equal(
      digest(license),
      vcRuntimeLicense.sha256,
      'Microsoft CRT license SHA-256 mismatch',
    );
    const partial = path.join(staging, vcRuntimeLicense.name);
    await writeFile(partial, license, { flag: 'wx' });
    await rename(partial, path.join(directory, vcRuntimeLicense.name));
    return { directory, files: vcRuntimeFiles, license: vcRuntimeLicense };
  } finally {
    assert.equal(path.dirname(staging), cache);
    assert.ok(path.basename(staging).startsWith('.stage-'));
    assert.equal(await realpath(staging), staging, 'Redirected VC runtime staging directory');
    await rm(staging, { recursive: true, force: true });
  }
}

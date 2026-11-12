import { open } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import workspace from '../../shared/scripts/workspace.mjs';

const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const required = new Map([
  [0, '0'],
  [2, '0'],
  [3, '0'],
  [4, '1'],
  [5, '1'],
]);

// The documented V1 wire is bounded and uniquely located. Refuse an unfamiliar
// runtime rather than silently patching an offset from another Electron build.
export async function productionFuses(file, { write = false } = {}) {
  const handle = await open(file, write ? 'r+' : 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let tail = Buffer.alloc(0),
      offset = 0,
      location;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      const bytes = Buffer.concat([tail, buffer.subarray(0, bytesRead)]);
      for (let i = bytes.indexOf(sentinel); i !== -1; i = bytes.indexOf(sentinel, i + 1)) {
        if (location !== undefined) throw Error('Ambiguous Electron fuse wire');
        location = offset - tail.length + i + sentinel.length;
      }
      tail = Buffer.from(bytes.subarray(-(sentinel.length - 1)));
      offset += bytesRead;
    }
    if (location === undefined) throw Error('Electron fuse wire is missing');
    const header = Buffer.alloc(2);
    if (
      (await handle.read(header, 0, 2, location)).bytesRead !== 2 ||
      header[0] !== 1 ||
      header[1] < 6 ||
      header[1] > 128
    )
      throw Error('Unsupported Electron fuse schema');
    const wire = Buffer.alloc(header[1]);
    if (
      (await handle.read(wire, 0, wire.length, location + 2)).bytesRead !== wire.length ||
      [...wire].some((value) => ![0x30, 0x31, 0x72].includes(value))
    )
      throw Error('Invalid Electron fuse wire');
    for (const [index, state] of required) {
      if (wire[index] === 0x72) throw Error('A required production fuse was removed');
      if (write) wire[index] = state.charCodeAt(0);
      else if (wire[index] !== state.charCodeAt(0))
        throw Error('Unsafe production Electron fuse: ' + index);
    }
    if (write) {
      if ((await handle.write(wire, 0, wire.length, location + 2)).bytesWritten !== wire.length)
        throw Error('Incomplete Electron fuse write');
      await handle.sync();
    }
    return wire.toString('ascii');
  } finally {
    await handle.close();
  }
}

export async function prepareProductionRuntime(app, signing) {
  const native = path.join(workspace.platformRoot, 'native');
  for (const [source, destination] of [
    ['ProductionMain.mm', 'Contents/MacOS/VoxCue'],
    ['RuntimeIntegrity.mm', 'Contents/Resources/native/VoxCue.Integrity'],
  ]) {
    const result = spawnSync(
      '/usr/bin/xcrun',
      [
        'clang++',
        '-std=c++17',
        '-fobjc-arc',
        '-O2',
        '-arch',
        'arm64',
        '-mmacosx-version-min=14.2',
        '-DVOXCUE_SIGNING_SHA1="' + signing.sha1.toLowerCase() + '"',
        path.join(native, source),
        '-framework',
        'Foundation',
        '-framework',
        'Security',
        '-o',
        path.join(app, destination),
      ],
      { encoding: 'utf8' },
    );
    if (result.error || result.status) throw result.error ?? Error(result.stderr);
  }
  await productionFuses(
    path.join(app, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'),
    { write: true },
  );
}

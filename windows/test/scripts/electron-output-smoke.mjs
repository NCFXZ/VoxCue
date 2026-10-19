import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { replaceGeneratedOutput, lockOutput } from '../../../shared/scripts/electron-output.mjs';

const output = path.join(testRoot, 'dist-electron'),
  stage = path.join(testRoot, 'stage'),
  backup = path.join(testRoot, 'backup');
await fs.mkdir(path.join(output, 'shared'), { recursive: true });
await fs.mkdir(path.join(stage, 'shared'), { recursive: true });
await fs.writeFile(path.join(output, 'shared/a.js'), 'previous');
await fs.writeFile(path.join(output, 'shared/stale.js'), 'stale');
await fs.writeFile(path.join(stage, 'shared/a.js'), 'current');
await fs.writeFile(path.join(stage, 'shared/new.js'), 'new');
const identity = (await fs.stat(output)).ino,
  nestedIdentity = (await fs.stat(path.join(output, 'shared'))).ino;
const source = path.join(testRoot, 'OutputLock.cs'),
  executable = path.join(testRoot, 'OutputLock.exe');
await fs.writeFile(
  source,
  'using System;using System.IO;class OutputLock {static void Main(string[] args){using(var file=new FileStream(args[0],FileMode.Open,FileAccess.Read,FileShare.None)){Console.WriteLine("locked");Console.ReadLine();}}}',
);
const compiled = spawnSync(
  path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  ['/nologo', '/out:' + executable, source],
  { encoding: 'utf8', windowsHide: true },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const child = spawnTestProcess(executable, [path.join(output, 'shared/a.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
const closed = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Lock helper timeout')), 10000);
    child.stdout.once('data', (data) => {
      clearTimeout(timeout);
      assert.equal(data.toString().trim(), 'locked');
      resolve();
    });
  });
  await assert.rejects(replaceGeneratedOutput(stage, output, backup), (error) =>
    ['EBUSY', 'EPERM', 'EACCES'].includes(error.code),
  );
} finally {
  child.stdin.end('\n');
  await closed;
}
assert.equal(await fs.readFile(path.join(output, 'shared/a.js'), 'utf8'), 'previous');
assert.equal(await fs.readFile(path.join(output, 'shared/stale.js'), 'utf8'), 'stale');
await assert.rejects(
  replaceGeneratedOutput(stage, output, backup, async (from, to) => {
    if (path.basename(from) === 'new.js') {
      await fs.writeFile(to, 'partial');
      throw Error('synthetic disk write failure');
    }
    await fs.copyFile(from, to);
  }),
  /synthetic disk write failure/,
);
assert.deepEqual(await fs.readdir(path.join(output, 'shared')), ['a.js', 'stale.js']);
assert.equal(await fs.readFile(path.join(output, 'shared/a.js'), 'utf8'), 'previous');
const release = await lockOutput(output);
try {
  await assert.rejects(lockOutput(output), /Another Electron build/);
} finally {
  await release();
}
await replaceGeneratedOutput(stage, output, backup);
assert.equal((await fs.stat(output)).ino, identity);
assert.equal((await fs.stat(path.join(output, 'shared'))).ino, nestedIdentity);
assert.deepEqual(await fs.readdir(path.join(output, 'shared')), ['a.js', 'new.js']);
console.log(
  'PASS Windows exclusive output lock, partial-write rollback, concurrent build rejection and directory identity',
);

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
const executable = path.join(testRoot, 'WasapiPacketProbe.exe');
const compiled = spawnSync(
  path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/platform:x64',
    '/target:exe',
    '/main:WasapiPacketProbe',
    '/r:System.Web.Extensions.dll',
    '/out:' + executable,
    path.resolve('native/WasapiCapture.cs'),
    path.resolve('test/fixtures/WasapiPacketProbe.cs'),
  ],
  { encoding: 'utf8', windowsHide: true },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const require = createRequire(import.meta.url);
const { PacketDecoder } = require(
  path.resolve('dist-electron/shared/electron/backend/speech/buffer.js'),
);
for (let processIndex = 0; processIndex < 2; processIndex++) {
  const child = spawnSync(executable, [], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  const bytes = Buffer.from(child.stdout.trim(), 'base64'),
    decoder = new PacketDecoder();
  const packets = [...decoder.push(bytes.subarray(0, 11)), ...decoder.push(bytes.subarray(11))];
  assert.equal(packets.length, 2);
  assert.equal(packets[0].timestamp, 987654321);
  assert.equal(packets[1].timestamp - packets[0].timestamp, 10);
  assert.equal(packets[0].flags, 0);
  assert.equal(packets[1].flags, 5);
  for (const packet of packets) {
    assert.equal(packet.rate, 48000);
    for (const [index, expected] of [0.6, 0.2, 0.1].entries())
      assert.ok(Math.abs(packet.samples[index] - expected) < 1e-6);
  }
}
console.log(
  'PASS native WASAPI mix, QPC, packet flags, FIFO, closed receiver and bounded drain; no hardware',
);

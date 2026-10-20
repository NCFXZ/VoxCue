import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { CoreAudioCapture, devices, probeDevice } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/macos/electron/speech/capture.js'),
);
const helper = path.join(testRoot, 'synthetic-audio.cjs');
await writeFile(
  helper,
  `#!${process.execPath}
const values=['system','microphone'].map(source=>({id:source,name:'Synthetic '+source,source,default:true}));
if(process.argv[2]==='devices'){console.log(JSON.stringify(values));process.exit(0);}
if(process.argv[2]==='check'){console.log(JSON.stringify({ok:true,samplesRead:0}));process.exit(0);}
const mode=Buffer.from(process.argv[3]||'','base64').toString();
let sequence=0;
function packet(tail=false){
 const b=Buffer.alloc(4+17+160*4);b.writeUInt32LE(b.length-4);b[4]=1;b.writeUInt32LE(16000,5);b.writeDoubleLE(sequence++*10,9);b.writeUInt32LE(0,17);
 for(let i=0;i<160;i++)b.writeFloatLE(mode==='nan'?NaN:tail?0.25:1.25,21+i*4);
 process.stdout.write(b.subarray(0,7));process.stdout.write(b.subarray(7));
}
process.stderr.write(JSON.stringify({type:'started'})+'\\n');
const timer=setInterval(packet,10);
process.stdin.resume();process.stdin.on('end',()=>{clearInterval(timer);packet(true);});
`,
);
await chmod(helper, 0o700);
assert.equal((await devices(helper)).length, 2);
assert.deepEqual(await probeDevice(helper, 'system'), { ok: true });
for (let cycle = 0; cycle < 20; cycle++) {
  const packets = [],
    errors = [];
  const capture = new CoreAudioCapture(
    helper,
    cycle % 2 ? 'system' : 'microphone',
    '',
    (packet) => packets.push(packet),
    (error) => errors.push(error),
  );
  await capture.start();
  const pid = capture.child.pid;
  const deadline = Date.now() + 5000;
  while (!packets.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await capture.stop();
  assert.ok(packets.length);
  assert.equal(packets.at(-1).samples[0], 0.25, 'stop must drain the last packet');
  assert.ok(
    packets.some((packet) => packet.samples[0] === 1.25),
    'finite PCM above unity remains valid',
  );
  assert.deepEqual(errors, []);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}
let fail;
const failed = new Promise((resolve) => (fail = resolve));
const invalid = new CoreAudioCapture(
  helper,
  'system',
  'nan',
  () => assert.fail('NaN must not reach consumer'),
  fail,
);
await invalid.start();
assert.match(
  await Promise.race([
    failed,
    new Promise((_, reject) => setTimeout(() => reject(Error('NaN rejection timeout')), 5000)),
  ]),
  /无效/,
);
await invalid.stop();
console.log(
  'PASS: Mac capture adapter with synthetic process only; fragmented packets, finite PCM, NaN rejection, 20 EOF/drain cycles and actual child exit. No hardware access.',
);

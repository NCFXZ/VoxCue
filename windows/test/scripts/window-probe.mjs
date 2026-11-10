import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
const executable = path.join(testRoot, 'WindowProbe.exe');
const framework = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319');
const compiled = spawnSync(
  path.join(framework, 'csc.exe'),
  [
    '/nologo',
    '/platform:x64',
    '/target:exe',
    '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll',
    ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(
      (name) => '/r:' + path.join(framework, 'WPF', name + '.dll'),
    ),
    '/out:' + executable,
    fileURLToPath(new URL('../fixtures/WindowProbe.cs',import.meta.url)),
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 30000 },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
export function probe(...args) {
  const result = spawnSync(executable, args.map(String), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

// Wait for both Chromium layout and the actual DIP-to-screen projection after resize/DPI transitions.
export async function stableTarget(locator, project) {
  let previous='', stable=0, last;
  const end=performance.now()+5000;
  do {
    assert.equal(probe('desktop').interactive,true,'Native input requires an unlocked desktop');
    const box=await locator.boundingBox();
    if(box) {
      const point=await project(box),key=JSON.stringify({box,point});
      stable=key===previous?stable+1:0;previous=key;last={box,point};
      if(stable>=3) return point;
    } else {stable=0;previous='';}
    await new Promise(resolve=>setTimeout(resolve,40));
  } while(performance.now()<end);
  throw Error('Native target did not stabilize: '+JSON.stringify(last));
}

export const probeExecutable = executable;

async function holdProbe(args, expected, label) {
  const child=spawnTestProcess(probeExecutable,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let failure='';child.stderr.on('data',chunk=>failure+=chunk);
  const timer=setTimeout(()=>child.kill('SIGTERM'),10000);
  try {
    const data=await Promise.race([once(child.stdout,'data').then(([value])=>value),once(child,'exit').then(()=>{throw Error(label+' could not start: '+failure);})]);
    assert.deepEqual(JSON.parse(data),expected);
  } catch(error) {child.kill('SIGTERM');throw error;}
  finally {clearTimeout(timer);}
  let releasing;
  return () => releasing ??= (async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.stdin.end();
      await exit;
    }
  })();
}
export const holdExclusiveFiles = (files) => holdProbe(['hold-file',...files],{holding:true},'Exclusive guard');
export async function holdDesktopAwake() {
  assert.equal(probe('desktop').interactive,true,'A power request requires the unlocked owner console');
  return holdProbe(['hold-awake'],{awake:true},'Desktop awake guard');
}

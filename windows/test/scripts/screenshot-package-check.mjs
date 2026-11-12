import assert from 'node:assert/strict';
import { realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { probe } from './window-probe.mjs';

/** Run packaged backend code and real unpacked N-API modules, never product main. */
export async function checkPackagedScreenshots(packageRoot) {
  assert.equal(process.platform, 'win32');
  assert.equal(probe('desktop').interactive, true, 'An unlocked owner console is required');
  const root = await realpath(packageRoot);
  assert.ok(root.startsWith(testRoot + path.sep), "Use this run's owned package");
  const directory = path.join(testRoot, 'packaged-screenshot');
  const profile = path.join(directory, 'profile');
  await mkdir(profile, { recursive: true });
  const archive = path.join(root, 'resources/app.asar');
  const fixture = path.join(testRoot, 'packaged-screenshot.cjs');
  await writeFile(
    fixture,
    `
const {app}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const threads=require('node:worker_threads');
app.setAppPath(${JSON.stringify(archive)});
app.setPath('userData',${JSON.stringify(profile)});
app.setPath('sessionData',${JSON.stringify(profile)});
app.whenReady().then(async()=>{
  assert.equal(app.getPath('userData'),${JSON.stringify(profile)});
  assert.equal(app.getPath('sessionData'),${JSON.stringify(profile)});
  assert.equal(typeof global.gc,'function','The isolated host must allow explicit post-task GC');
  const OriginalWorker=threads.Worker;
  let active=0,peak=0,lastWorker;
  threads.Worker=class extends OriginalWorker {
    constructor(...args){super(...args);lastWorker=this;active++;peak=Math.max(peak,active);this.once('exit',()=>active--);}
  };
  const load=require('node:module').createRequire(${JSON.stringify(archive)}+'/package.json');
  const {encodeScreenshotBitmap}=load('./dist-electron/shared/electron/backend/screenshot/host.js');
  const width=3840,height=2160,frameBytes=width*height*4;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const frame=(index,random)=>{
    const bitmap=new ArrayBuffer(frameBytes),pixels=new Uint8Array(bitmap);
    let seed=7153+index;
    for(let i=0;i<pixels.length;i+=4){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      pixels[i]=random?seed&255:index+10;
      pixels[i+1]=random?(seed>>>8)&255:index+30;
      pixels[i+2]=random?(seed>>>16)&255:200-index;
      pixels[i+3]=255;
    }
    return {width,height,bitmap};
  };
  const rss=[],hashes=new Set(),formats=new Set();
  const collect=async()=>{global.gc();await pause(25);global.gc();return process.memoryUsage().rss;};
  const validate=(result)=>{
    assert.ok(['screenshot.png','screenshot.jpg'].includes(result.file.name));
    assert.ok(result.file.bytes.length>0&&result.file.bytes.length<=8*1024*1024);
    const bytes=Buffer.from(result.file.bytes);
    if(result.file.name.endsWith('.png')){
      assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),height);
    } else assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
    assert.match(result.preview,/^data:image\\/jpeg;base64,/);
    const preview=Buffer.from(result.preview.split(',')[1],'base64');
    assert.equal(preview.subarray(0,3).toString('hex'),'ffd8ff');
    assert.ok(preview.length<=256*1024);
    assert.equal(active,0,'The encoding promise must retain its slot until the real Worker exits');
    formats.add(result.file.name);
    const digest=crypto.createHash('sha256').update(bytes).digest('hex');
    assert.ok(!hashes.has(digest),'Distinct source frames must not reuse stale output');hashes.add(digest);
  };
  const before=await collect();
  for(let i=0;i<30;i++){
    let input=frame(i,i%2===1);
    let result=await encodeScreenshotBitmap(input,new AbortController().signal);
    assert.equal(input.bitmap.byteLength,0,'The private bitmap must transfer ownership');
    validate(result);result=undefined;input=undefined;
    rss.push(await collect());
  }
  assert.deepEqual([...formats].sort(),['screenshot.jpg','screenshot.png']);
  const controller=new AbortController();
  const pending=encodeScreenshotBitmap(frame(50,true),controller.signal);
  const cancellation=assert.rejects(pending,error=>error.name==='AbortError');
  await new Promise(resolve=>lastWorker.once('online',resolve));
  await pause(75);controller.abort();await cancellation;
  assert.equal(active,0,'Cancellation must retire its native Worker');
  const finalRss=await collect();
  const average=values=>values.reduce((a,b)=>a+b,0)/values.length;
  const middle=average(rss.slice(10,20)),last=average(rss.slice(20,30));
  assert.ok(last-middle<frameBytes,'Post-GC native RSS must not grow by a full 4K frame per ten steady-state encodes');
  assert.ok(finalRss-rss[9]<frameBytes*3,'The final working set must remain bounded after warmup and cancellation');
  assert.equal(peak,1,'Packaged encoders must remain serialized');
  console.log(JSON.stringify({kind:'packaged-asar-screenshot-worker',iterations:30,cancelled:1,
    formats:[...formats],activeWorkers:active,peakWorkers:peak,memory:{before,warmup:rss[9],middle,last,final:finalRss}}));
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
`,
  );
  const child = spawnTestProcess(
    workspace.platformRequire('electron'),
    [await offlineElectronEntry(fixture), '--js-flags=--expose-gc'],
    {
      cwd: workspace.platformRoot,
      env: { ...process.env, COPILOT_TEST_USER_DATA: profile, ELECTRON_RUN_AS_NODE: undefined },
      windowsHide: true,
      stdio: 'inherit',
    },
  );
  let failure;
  const monitor = setInterval(() => {
    try {
      assert.equal(
        probe('desktop').interactive,
        true,
        'Owner console locked during native encoding',
      );
    } catch (error) {
      failure = error;
      child.kill();
    }
  }, 1000);
  const timer = setTimeout(() => {
    failure = Error('Packaged screenshot encoding timed out');
    child.kill();
  }, 180000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (failure) throw failure;
    assert.equal(code, 0, 'Final ASAR screenshot Worker regression failed');
  } finally {
    clearTimeout(timer);
    clearInterval(monitor);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

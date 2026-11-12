import { requireGuestIsolation } from './guest-isolation.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verifyLocalApp } from '../../scripts/development-signing.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

let probe;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Untouched final browser, normal native window and Quit. No inspector/test entry. */
export async function runGuestProduct(
  bundle,
  { env = process.env, args = [], ready, probeSignal } = {},
) {
  await requireGuestIsolation();
  assert.ok(
    bundle.startsWith(testRoot + path.sep),
    'Only this guest run’s extracted product is accepted',
  );
  verifyLocalApp(
    bundle,
    workspace.platformRequire(path.join(workspace.platformRoot, 'local-signing-public.json')),
    'com.voxcue.app',
  );
  if (!probe) {
    probe = path.join(testRoot, 'owned-product-window');
    await writeFile(
      probe + '.mm',
      `#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
int main(int argc,const char **argv){@autoreleasepool{
 if(argc!=3)return 64;pid_t pid=atoi(argv[2]);
 NSRunningApplication *app=[NSRunningApplication runningApplicationWithProcessIdentifier:pid];
 if(!app)return 1;
 if(strcmp(argv[1],"quit")==0)return [app terminate]?0:1;
 NSArray *windows=CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly,kCGNullWindowID));
 for(NSDictionary *window in windows)if([window[(id)kCGWindowOwnerPID] intValue]==pid&&[window[(id)kCGWindowLayer] intValue]==0)return 0;
 return 1;
}}
`,
    );
    execFileSync('/usr/bin/xcrun', [
      'clang++',
      '-fobjc-arc',
      probe + '.mm',
      '-framework',
      'AppKit',
      '-framework',
      'CoreGraphics',
      '-o',
      probe,
    ]);
  }
  const releaseDesktop = holdDesktopAwake();
  const child = spawnTestProcess(path.join(bundle, 'Contents/MacOS/VoxCue'), args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output = (output + data).slice(-12000);
  });
  child.stderr.on('data', (data) => {
    output = (output + data).slice(-12000);
  });
  try {
    let visible = false;
    for (let i = 0; i < 180; i++) {
      requireUnlockedDesktop();
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error('Untouched final product exited before a window: ' + output);
      if (spawnSync(probe, ['visible', String(child.pid)]).status === 0) {
        visible = true;
        break;
      }
      await delay(500);
    }
    assert.ok(visible, 'The untouched final product must show its native window');
    await ready?.(child.pid);
    if (probeSignal) {
      assert.equal(probeSignal, 'SIGUSR1');
      child.kill(probeSignal);
      await delay(1000);
    }
    if (child.exitCode === null && child.signalCode === null) {
      if (probeSignal) await ready?.(child.pid);
      assert.equal(
        spawnSync(probe, ['quit', String(child.pid)]).status,
        0,
        'The product must accept normal native Quit',
      );
    } else assert.ok(probeSignal, 'Normal product exited before the requested native Quit');
    let timer;
    try {
      const outcome = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Final product did not drain and quit: ' + output)),
            30000,
          );
        }),
      ]);
      // A disabled Node debug-signal handler may leave POSIX's default signal
      // termination. The two ordinary launches still require natural Quit=0.
      if (probeSignal && outcome.signal === probeSignal) assert.equal(outcome.code, null);
      else assert.deepEqual(outcome, { code: 0, signal: null });
    } finally {
      clearTimeout(timer);
    }
    for (let i = 0; i < 40; i++) {
      const inventory = execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' });
      if (!inventory.split('\n').some((line) => line.trim().startsWith(bundle + '/'))) return;
      await delay(250);
    }
    throw Error('Final product left a bundled SDK/utility/helper process after Quit');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    releaseDesktop();
  }
}

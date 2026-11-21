import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { verifyLocalApp } from '../../scripts/development-signing.mjs';
import { withMountedDmg } from '../../scripts/dmg.mjs';
import { requireGuestIsolation } from './guest-isolation.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

await requireGuestIsolation();
const installed = '/Applications/VoxCue.app';
const userData = path.join(os.homedir(), 'Library/Application Support/VoxCue');
for (const target of [installed, userData]) {
  await assert.rejects(lstat(target), { code: 'ENOENT' }, 'The disposable guest must start clean');
}
const pin = workspace.platformRequire(path.join(workspace.platformRoot, 'local-signing-public.json'));
const version = workspace.platformRequire('./package.json').version;
const dmg = path.join(process.env.VOXCUE_TEST_RELEASE_DIR, `VoxCue-${version}-arm64.dmg`);
const mount = path.join(testRoot, 'installer');
await mkdir(mount);
const quarantine = file => {
  const list = execFileSync('/usr/bin/xattr', [file], { encoding: 'utf8' }).split('\n');
  return list.includes('com.apple.quarantine')
    ? execFileSync('/usr/bin/xattr', ['-px', 'com.apple.quarantine', file], { encoding: 'utf8' }).trim()
    : null;
};
execFileSync('/usr/bin/hdiutil', ['verify', dmg], { stdio: 'pipe' });
await withMountedDmg(dmg, mount, async () => {
  assert.equal(await realpath(path.join(mount, 'Applications')), '/Applications');
  const source = path.join(mount, 'VoxCue.app');
  verifyLocalApp(source, pin, 'com.voxcue.app');
  const originalQuarantine = quarantine(source);
  execFileSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--qtn', source, installed]);
  assert.equal(await realpath(installed), installed);
  assert.equal(quarantine(installed), originalQuarantine);
  console.log('Installed directly from the read-only DMG into /Applications/VoxCue.app; source quarantine attribute ' +
    (originalQuarantine === null ? 'absent.' : 'preserved.'));
}, true);
verifyLocalApp(installed, pin, 'com.voxcue.app');
const source = path.join(testRoot, 'dmg-launch.m');
const probe = path.join(testRoot, 'dmg-launch');
await writeFile(source, `#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
static void tick(void) { [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.1]]; }
int main(int argc,const char **argv) { @autoreleasepool {
  if (argc != 2) return 64;
  NSURL *url=[NSURL fileURLWithPath:@(argv[1]) isDirectory:YES];
  __block NSRunningApplication *app=nil;
  __block BOOL opened=NO;
  [[NSWorkspace sharedWorkspace] openApplicationAtURL:url configuration:[NSWorkspaceOpenConfiguration configuration]
    completionHandler:^(NSRunningApplication *result,NSError *error) {
      app=result; opened=YES;
      if (error) fprintf(stderr,"LaunchServices error %s %ld\\n",error.domain.UTF8String,(long)error.code);
    }];
  NSDate *end=[NSDate dateWithTimeIntervalSinceNow:90];
  while (!opened && end.timeIntervalSinceNow>0) tick();
  if (!app || ![app.bundleURL.path isEqualToString:url.path]) return 1;
  BOOL visible=NO;
  while (!visible && !app.terminated && end.timeIntervalSinceNow>0) {
    @autoreleasepool {
      NSArray *windows=CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly,kCGNullWindowID));
      for (NSDictionary *w in windows)
        if ([w[(id)kCGWindowOwnerPID] intValue]==app.processIdentifier && [w[(id)kCGWindowLayer] intValue]==0) visible=YES;
    }
    if (!visible) tick();
  }
  if (![app terminate]) return 2;
  end=[NSDate dateWithTimeIntervalSinceNow:45];
  while (!app.terminated && end.timeIntervalSinceNow>0) tick();
  return visible && app.terminated ? 0 : 3;
} }`);
execFileSync('/usr/bin/xcrun', ['clang', '-fobjc-arc', source, '-framework', 'AppKit', '-framework', 'CoreGraphics', '-o', probe]);
const releaseDesktop = holdDesktopAwake();
try {
  for (let i = 0; i < 2; i++) {
    requireUnlockedDesktop();
    execFileSync(probe, [installed], { timeout: 145_000, stdio: 'inherit' });
    const deadline = Date.now() + 10_000;
    for (;;) {
      const processes = spawnSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' });
      assert.equal(processes.status, 0);
      if (!processes.stdout.split('\n').some(line => line.trim().startsWith(installed + '/'))) break;
      assert.ok(Date.now() < deadline, 'Installed app must release its bundled children on Quit');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  verifyLocalApp(installed, pin, 'com.voxcue.app');
  await rename(userData, path.join(testRoot, 'dmg-user-data'));
  await rename(installed, path.join(testRoot, 'dmg-installed.app'));
  console.log('PASS: LaunchServices opened the real /Applications installation twice, showed its native window and quit cleanly each time.');
} finally {
  releaseDesktop();
}

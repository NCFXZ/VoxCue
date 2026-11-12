import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { cp, mkdir, readFile, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { signMacApp } from '../../scripts/sign-app.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

// The VM is provisioned separately from an authenticated public image. It must
// be disposable and stopped; this runner never attaches an existing live user VM.
const tart = process.env.VOXCUE_TEST_TART;
const home = process.env.VOXCUE_TEST_TART_HOME;
const vm = process.env.VOXCUE_TEST_VM;
const release = process.env.VOXCUE_TEST_RELEASE_DIR;
const cache = process.env.VOXCUE_TEST_COMPONENT_CACHE;
const server = process.env.VOXCUE_TEST_SERVER_ROOT;
if (
  ![tart, home, release, cache, server].every((value) => value && path.isAbsolute(value)) ||
  !/^voxcue[\w-]+$/.test(vm ?? '')
)
  throw Error(
    'Use explicit disposable Tart VM, release, authenticated component cache and synthetic server inputs.',
  );
const ownerRoot = path.dirname(home);
const owner = JSON.parse(await readFile(path.join(ownerRoot, '.owner.json'), 'utf8'));
assert.equal(owner.kind, 'voxcue-macos-120');
assert.equal(owner.uid, process.getuid());
assert.equal(await realpath(ownerRoot), ownerRoot);
const toolEnvironment = { ...process.env, TART_HOME: home, TART_NO_AUTO_PRUNE: '1' };
const source = JSON.parse(await readFile(path.join(ownerRoot, 'vm-image-source.json'), 'utf8'));
assert.match(source.reference, /^ghcr\.io\/cirruslabs\/macos-tahoe-base@sha256:[a-f0-9]{64}$/);
try {
  execFileSync(tart, ['get', vm, '--format', 'json'], { env: toolEnvironment, stdio: 'ignore' });
} catch {
  execFileSync(tart, ['clone', source.reference, vm], { env: toolEnvironment, stdio: 'inherit' });
}
const config = JSON.parse(
  execFileSync(tart, ['get', vm, '--format', 'json'], {
    env: toolEnvironment,
    encoding: 'utf8',
  }),
);
assert.ok(
  config.state === 'stopped' || config.State === 'stopped',
  'The disposable VM must be stopped',
);
execFileSync(tart, ['set', '--cpu', '6', '--memory', '12288', vm], {
  env: toolEnvironment,
  stdio: 'inherit',
});
const version = workspace.platformRequire(
  path.join(workspace.platformRoot, 'package.json'),
).version;
const inputs = path.join(testRoot, 'inputs'),
  repo = path.join(inputs, 'repo');
await mkdir(repo, { recursive: true, mode: 0o700 });
async function copy(source, destination) {
  const stat = await lstat(source);
  assert.ok(
    stat.isDirectory() || stat.isFile(),
    'Only explicit code/public inputs may enter the guest',
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
}
// These directories contain source/fixtures only. No workspace-wide copy, private
// .tools directory, environment file, Keychain, user profile or login state enters.
for (const relative of [
  'shared/scripts',
  'shared/test/scripts',
  'shared/test/fixtures',
  'macos/scripts',
  'macos/test/scripts',
  'macos/test/fixtures',
  'macos/dist-electron',
  'macos/dist',
  'macos/public',
  'macos/package.json',
  'macos/local-signing-public.json',
  'macos/update-public-key.json',
  'macos/native/DmgArtwork.mm',
  'macos/native/bin/VoxCue.Credentials',
  'macos/.cache/dmg-tools',
  'macos/.cache/node-api-headers',
  'macos/.tools/dmg-artwork',
  'macos/.tools/electron-dev',
])
  await copy(path.join(workspace.repositoryRoot, relative), path.join(repo, relative));
// Frozen public npm code only; no package-manager cache or prior test output.
await cp(path.join(workspace.platformRoot, 'node_modules'), path.join(repo, 'macos/node_modules'), {
  recursive: true,
  dereference: true,
  filter: async (file) => {
    const relative = path.relative(path.join(workspace.platformRoot, 'node_modules'), file);
    if (/(?:^|\/)\.(?:cache|vite|tmp)(?:\/|$)/.test(relative)) return false;
    if ((await lstat(file)).isSymbolicLink())
      assert.ok(
        (await realpath(file)).startsWith(
          path.join(workspace.platformRoot, 'node_modules') + path.sep,
        ),
      );
    return true;
  },
});
await copy(release, path.join(inputs, 'release'));
await copy(
  path.join(workspace.platformRoot, 'release/1.1.1/VoxCue-1.1.1-arm64.zip'),
  path.join(repo, 'macos/release/1.1.1/VoxCue-1.1.1-arm64.zip'),
);
await copy(cache, path.join(inputs, 'components'));
await copy(server, path.join(inputs, 'server'));

// Sparkle uses NSBundle.mainBundle, not app.getVersion(). Give this separate
// development fixture a lower version and the public update key. The final
// product archive/executable/signatures remain byte-for-byte unchanged.
const unpacked = path.join(testRoot, 'fixture-resources');
execFileSync('/usr/bin/ditto', [
  '-x',
  '-k',
  path.join(release, `VoxCue-${version}-arm64.zip`),
  unpacked,
]);
const host = path.join(repo, 'macos/.tools/electron-dev/Electron.app');
await copy(
  path.join(unpacked, 'VoxCue.app/Contents/Frameworks/Sparkle.framework'),
  path.join(host, 'Contents/Frameworks/Sparkle.framework'),
);
const plist = path.join(host, 'Contents/Info.plist');
const publicKey = workspace.platformRequire(
  path.join(workspace.platformRoot, 'update-public-key.json'),
).publicKey;
for (const [key, value] of [
  ['CFBundleVersion', '0.2.0'],
  ['CFBundleShortVersionString', '0.2.0'],
  ['SUPublicEDKey', publicKey],
]) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]);
  }
}
await signMacApp(host, { identifier: 'com.voxcue.development', preserveMetadata: true });
await rm(unpacked, { recursive: true, force: true });

const hostUUID = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
  encoding: 'utf8',
}).match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]+)"/)?.[1];
assert.ok(hostUUID);
const nonce = randomBytes(16).toString('hex');
const guestRoot = '/private/tmp/voxcue-macos-guest-' + nonce;
const controller = path.join(testRoot, 'disconnected-vm.py');
await writeFile(
  controller,
  `import socket,subprocess,sys,signal\nleft,right=socket.socketpair(socket.AF_UNIX,socket.SOCK_DGRAM)\nargs=[str(right.fileno()) if arg=='@NETFD@' else arg for arg in sys.argv[1:]]\nchild=subprocess.Popen(args,pass_fds=(right.fileno(),))\nright.close()\ndef stop(*_):\n child.terminate()\nsignal.signal(signal.SIGTERM,stop)\nleft.settimeout(.5)\nwhile child.poll() is None:\n try: left.recv(65536)\n except socket.timeout: pass\nfinally_code=child.wait()\nleft.close()\nsys.exit(finally_code)\n`,
);
const python = '/usr/bin/python3';
// FD number is fixed by this controller, not by a caller-provided network mode.
const boot = spawnTestProcess(
  python,
  [
    controller,
    tart,
    'run',
    '--no-graphics',
    '--no-clipboard',
    '--no-audio',
    '--no-usb-accessories',
    '--net-fd',
    '@NETFD@',
    '--dir',
    `voxcue-inputs:${inputs}:ro`,
    vm,
  ],
  { env: toolEnvironment, stdio: ['ignore', 'inherit', 'inherit'] },
);
const releaseDesktop = holdDesktopAwake();
async function guest(script, timeout = 120000) {
  requireUnlockedDesktop();
  const child = spawnTestProcess(tart, ['exec', '-i', vm, '/opt/homebrew/bin/node', '-'], {
    env: toolEnvironment,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  child.stdin.end(script);
  let failure;
  const stop = (error) => {
    failure ??= error;
    child.kill('SIGTERM');
    // Closing a vsock client alone cannot retire a stuck guest process tree.
    try {
      execFileSync(tart, ['stop', vm], { env: toolEnvironment, stdio: 'ignore', timeout: 30000 });
    } catch {
      /* The outer cleanup verifies stopped state before deleting the VM. */
    }
  };
  const timer = setTimeout(() => stop(Error('Guest command timed out')), timeout);
  const desktop = setInterval(() => {
    try {
      requireUnlockedDesktop();
    } catch (error) {
      stop(error);
    }
  }, 2000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    if (failure) throw failure;
    assert.equal(code, 0, 'Guest command failed');
  } finally {
    clearTimeout(timer);
    clearInterval(desktop);
  }
}
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    requireUnlockedDesktop();
    try {
      execFileSync(tart, ['exec', vm, '/usr/bin/true'], {
        env: toolEnvironment,
        stdio: 'ignore',
        timeout: 5000,
      });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  assert.ok(ready, 'Disposable guest did not boot');
  await guest(
    `const fs=require('node:fs'),cp=require('node:child_process');
const root=${JSON.stringify(guestRoot)},mount='/Volumes/My Shared Files/voxcue-inputs';
fs.mkdirSync(root,{mode:0o700});
const uuid=cp.execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{encoding:'utf8'}).match(/"IOPlatformUUID"\\s*=\\s*"([A-Fa-f0-9-]+)"/)[1];
fs.writeFileSync(root+'/context.json',JSON.stringify({version:1,root,nonce:${JSON.stringify(nonce)},guestUID:process.getuid(),guestMachineUUID:uuid,hostMachineUUID:${JSON.stringify(hostUUID)}}),{mode:0o600,flag:'wx'});
cp.execFileSync('/usr/bin/ditto',[mount+'/repo',root+'/repo']);
console.log('Guest isolated input staging complete; no routed network, clipboard, audio, USB or host home.');
`,
    300000,
  );
  for (const [name, args] of [
    ['package-security-smoke.mjs', []],
    ['package-runtimes-smoke.mjs', []],
    ['package-smoke.mjs', ['--install-archive']],
    ['components-smoke.mjs', []],
  ])
    await guest(
      `const cp=require('node:child_process');
const root=${JSON.stringify(guestRoot)},mount='/Volumes/My Shared Files/voxcue-inputs';
const env={...process.env,VOXCUE_TEST_GUEST_CONTEXT:root+'/context.json',VOXCUE_TEST_RELEASE_DIR:mount+'/release',VOXCUE_TEST_COMPONENT_CACHE:mount+'/components',VOXCUE_TEST_SERVER_ROOT:mount+'/server'};
const result=cp.spawnSync(process.execPath,[root+'/repo/macos/test/scripts/'+${JSON.stringify(name)},...${JSON.stringify(args)}],{cwd:root+'/repo/macos',env,stdio:'inherit',timeout:1200000});
if(result.error)throw result.error;process.exitCode=result.status??1;
`,
      1260000,
    );
} finally {
  try {
    try {
      execFileSync(tart, ['stop', vm], { env: toolEnvironment, stdio: 'ignore', timeout: 30000 });
    } catch {
      const state = JSON.parse(
        execFileSync(tart, ['get', vm, '--format', 'json'], {
          env: toolEnvironment,
          encoding: 'utf8',
        }),
      );
      assert.equal(state.Running, false, 'Cannot clean a still-running VM');
    }
    await new Promise((resolve) => {
      if (boot.exitCode !== null) resolve();
      else boot.once('exit', resolve);
    });
    execFileSync(tart, ['delete', vm], { env: toolEnvironment, stdio: 'inherit', timeout: 60000 });
  } finally {
    releaseDesktop();
  }
}
console.log(
  'PASS: disposable guest final-product and final-ASAR acceptance completed; guest inputs and profiles removed.',
);

import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { cp, mkdir, readFile, writeFile, realpath, readlink, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

const screenshotOnly = process.argv.includes('--screenshot-only');
const retainVM = process.argv.includes('--retain-vm');
if (process.argv.slice(2).some(arg => !['--screenshot-only', '--retain-vm'].includes(arg)))
  throw Error('Use --screenshot-only for the targeted regression; --retain-vm keeps its stopped isolated environment.');
// The VM is provisioned separately from an authenticated public image. It must
// be disposable and stopped; this runner never attaches an existing live user VM.
const tart = process.env.VOXCUE_TEST_TART;
const home = process.env.VOXCUE_TEST_TART_HOME;
const vm = process.env.VOXCUE_TEST_VM;
const release = process.env.VOXCUE_TEST_RELEASE_DIR;
const cache = process.env.VOXCUE_TEST_COMPONENT_CACHE;
if (
  ![tart, home, release, ...(!screenshotOnly ? [cache] : [])].every((value) => value && path.isAbsolute(value)) ||
  !/^voxcue[\w-]+$/.test(vm ?? '')
)
  throw Error(
    'Use explicit disposable Tart VM, release and authenticated component cache inputs.',
  );
const ownerRoot = path.dirname(home);
const owner = JSON.parse(await readFile(path.join(ownerRoot, '.owner.json'), 'utf8'));
assert.equal(owner.kind, 'voxcue-macos-120');
assert.equal(owner.uid, process.getuid());
assert.equal(await realpath(ownerRoot), ownerRoot);
const toolEnvironment = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  LANG: 'en_US.UTF-8',
  TART_HOME: home,
  TART_NO_AUTO_PRUNE: '1',
};
const source = JSON.parse(await readFile(path.join(ownerRoot, 'vm-image-source.json'), 'utf8'));
assert.match(source.reference, /^ghcr\.io\/cirruslabs\/macos-tahoe-base@sha256:[a-f0-9]{64}$/);
assert.match(source.preparedVM ?? '', /^voxcue[\w-]+-base$/,
  'Prepare a stopped SIP-enabled baseline from the pinned public image first');
assert.notEqual(vm, source.preparedVM, 'The disposable run must not delete its preparation baseline');
try {
  execFileSync(tart, ['get', vm, '--format', 'json'], { env: toolEnvironment, stdio: 'ignore' });
} catch {
  const baseline = JSON.parse(execFileSync(tart, ['get', source.preparedVM, '--format', 'json'], {
    env: toolEnvironment, encoding: 'utf8',
  }));
  assert.equal(baseline.State, 'stopped', 'The owned guest baseline must be stopped');
  execFileSync(tart, ['clone', source.preparedVM, vm], { env: toolEnvironment, stdio: 'inherit' });
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
assert.match(config.MACAddress, /^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i);
execFileSync(tart, ['set', '--cpu', '6', '--memory', '12288', vm], {
  env: toolEnvironment,
  stdio: 'inherit',
});
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
  'shared/package.json',
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
console.log('Staging guest source, fixed development host and canonical public dependencies.');
await cp(path.join(workspace.platformRoot, 'node_modules'), path.join(repo, 'macos/node_modules'), {
  recursive: true,
  verbatimSymlinks: true,
  filter: async (file) => {
    const relative = path.relative(path.join(workspace.platformRoot, 'node_modules'), file);
    if (/(?:^|\/)\.(?:bin|cache|vite|tmp)(?:\/|$)/.test(relative)) return false;
    // File Provider's numbered siblings are not package entry points. Avoid
    // reading a replica when the canonical installed node already exists.
    const canonical = path.basename(file).replace(/ \d+(?=\.|$)/g, '');
    if (canonical !== path.basename(file) &&
        await lstat(path.join(path.dirname(file), canonical)).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        })) return false;
    if ((await lstat(file)).isSymbolicLink()) {
      assert.equal(path.isAbsolute(await readlink(file)), false);
      assert.ok(
        (await realpath(file)).startsWith(
          path.join(workspace.platformRoot, 'node_modules') + path.sep,
        ),
      );
    }
    return true;
  },
});
console.log('Guest dependency staging complete; copying release' + (screenshotOnly ? ' for screenshot-only acceptance.' : ' and authenticated models.'));
await copy(release, path.join(inputs, 'release'));
if (!screenshotOnly) {
  await copy(
    path.join(workspace.platformRoot, 'release/1.1.1/VoxCue-1.1.1-arm64.zip'),
    path.join(repo, 'macos/release/1.1.1/VoxCue-1.1.1-arm64.zip'),
  );
  await copy(cache, path.join(inputs, 'components'));
}
// virtiofs can reject framework symlinks while traversing the shared tree.
// Transfer one regular archive and restore its links on the guest's local disk.
execFileSync('/usr/bin/ditto', [
  '-c', '-k', '--sequesterRsrc', '--keepParent', repo, path.join(inputs, 'repo.zip'),
], { stdio: 'inherit', timeout: 180000 });

const hostUUID = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
  encoding: 'utf8',
}).match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]+)"/)?.[1];
assert.ok(hostUUID);
const nonce = randomBytes(16).toString('hex');
// macOS clears /private/tmp on a cold boot. Explicitly retained fixtures need
// a guest-owned durable directory; no host home or product profile is shared.
const guestRoot = (retainVM ? '/Users/admin/Library/Application Support/' : '/private/tmp/') + 'voxcue-macos-guest-' + nonce;
const controller = path.join(testRoot, 'disconnected-vm.py');
await writeFile(
  controller,
  `import socket,subprocess,sys,signal\nleft,right=socket.socketpair(socket.AF_UNIX,socket.SOCK_DGRAM)\nargs=[str(right.fileno()) if arg=='@NETFD@' else arg for arg in sys.argv[1:]]\nchild=subprocess.Popen(args,pass_fds=(right.fileno(),))\nright.close()\ndef stop(*_):\n child.terminate()\nsignal.signal(signal.SIGTERM,stop)\nleft.settimeout(.5)\nwhile child.poll() is None:\n try: left.recv(65536)\n except socket.timeout: pass\nfinally_code=child.wait()\nleft.close()\nsys.exit(finally_code)\n`,
);
const python = '/usr/bin/python3';
// FD number is fixed by this controller, not by a caller-provided network mode.
const releaseDesktop = holdDesktopAwake();
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
console.log('Booting the disposable guest with disconnected network and read-only inputs.');
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
fs.mkdirSync(root,{mode:0o700,recursive:true});
const uuid=cp.execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{encoding:'utf8'}).match(/"IOPlatformUUID"\\s*=\\s*"([A-Fa-f0-9-]+)"/)[1];
fs.writeFileSync(root+'/context.json',JSON.stringify({version:1,root,nonce:${JSON.stringify(nonce)},guestUID:process.getuid(),guestMachineUUID:uuid,hostMachineUUID:${JSON.stringify(hostUUID)},syntheticIPv4:'192.168.248.2'}),{mode:0o600,flag:'wx'});
cp.execFileSync('/usr/bin/ditto',['-x','-k',mount+'/repo.zip',root]);
const check='import {requireGuestIsolation} from '+JSON.stringify(root+'/repo/macos/test/scripts/guest-isolation.mjs')+'; import {requireUnlockedDesktop} from '+JSON.stringify(root+'/repo/macos/test/scripts/desktop-session.mjs')+'; await requireGuestIsolation(); requireUnlockedDesktop();';
cp.execFileSync('/opt/homebrew/bin/node',['--input-type=module','-e',check],{env:{...process.env,VOXCUE_TEST_GUEST_CONTEXT:root+'/context.json'},stdio:'inherit'});
const nic=cp.execFileSync('/sbin/ifconfig',['en0'],{encoding:'utf8'});
if(nic.match(/ether ([a-f0-9:]+)/i)?.[1].toLowerCase()!==${JSON.stringify(config.MACAddress.toLowerCase())})throw Error('Unexpected guest virtual NIC');
cp.execFileSync('/usr/bin/sudo',['-n','/sbin/ifconfig','en0','inet','192.168.248.2','netmask','255.255.255.0','up'],{stdio:'inherit'});
if(!require('node:os').networkInterfaces().en0?.some(item=>item.address==='192.168.248.2'))throw Error('Synthetic guest IPv4 was not assigned');
console.log('Guest isolated input staging complete; no routed network, clipboard, audio, USB or host home.');
`,
    300000,
  );
  for (const [name, args] of screenshotOnly ? [['package-screenshot-smoke.mjs', []]] : [
    ['package-security-smoke.mjs', []],
    ['package-runtimes-smoke.mjs', []],
    ['package-smoke.mjs', ['--install-archive']],
    ['components-smoke.mjs', []],
  ])
    await guest(
      `const cp=require('node:child_process');
const root=${JSON.stringify(guestRoot)},mount='/Volumes/My Shared Files/voxcue-inputs';
const env={...process.env,VOXCUE_TEST_GUEST_CONTEXT:root+'/context.json',VOXCUE_TEST_RELEASE_DIR:mount+'/release',VOXCUE_TEST_COMPONENT_CACHE:mount+'/components'};
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
      if (boot.exitCode !== null || boot.signalCode !== null) resolve();
      else boot.once('exit', resolve);
    });
    if (retainVM)
      console.log('RETAINED_GUEST ' + JSON.stringify({ vm, guestRoot, context: guestRoot + '/context.json' }));
    else
      execFileSync(tart, ['delete', vm], { env: toolEnvironment, stdio: 'inherit', timeout: 60000 });
  } finally {
    releaseDesktop();
  }
}
console.log(
  'PASS: disposable guest ' + (screenshotOnly ? 'final-ASAR screenshot regression' : 'final-product and final-ASAR acceptance') +
  (retainVM ? ' completed; retained guest is stopped for subsequent isolated checks.' : ' completed; guest inputs and profiles removed.'),
);

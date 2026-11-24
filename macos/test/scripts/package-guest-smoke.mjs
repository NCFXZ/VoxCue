import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { cp, mkdir, readFile, writeFile, realpath, readlink, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
import { upgradeBaselinesFor, verifiedUpgradeArchive } from './package-upgrade-baselines.mjs';

const screenshotOnly = process.argv.includes('--screenshot-only');
const installOnly = process.argv.includes('--install-only');
const runtimeOnly = process.argv.includes('--runtime-only');
const upgradesOnly = process.argv.includes('--upgrades-only');
const retainVM = process.argv.includes('--retain-vm');
const args = process.argv.slice(2);
const selectedUpgrades = args.filter(arg => arg.startsWith('--from='));
const upgradeVersions = upgradeBaselinesFor(args);
if ((screenshotOnly && (installOnly || runtimeOnly || upgradesOnly)) || (upgradesOnly && (runtimeOnly || installOnly)) ||
    (selectedUpgrades.length && (screenshotOnly || (runtimeOnly && !installOnly))) ||
    args.some(arg => !arg.startsWith('--from=') &&
      !['--screenshot-only', '--install-only', '--runtime-only', '--upgrades-only', '--retain-vm'].includes(arg)))
  throw Error('Use the package guest checks documented in TEST_GUEST.md.');
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
const temporaryRoots = [await realpath(os.tmpdir()), '/private/tmp'];
assert.ok(temporaryRoots.some(root => ownerRoot.startsWith(root + path.sep)),
  'The guest must use a dedicated temporary root');
for (const folder of [ownerRoot, home]) {
  const info = await lstat(folder);
  assert.ok(info.isDirectory() && info.uid === process.getuid() &&
    !(info.mode & 0o022) && await realpath(folder) === folder, 'Unsafe guest directory');
}
assert.equal((await lstat(ownerRoot)).mode & 0o777, 0o700, 'Guest root must be private');
async function ownedRecord(name) {
  const file = path.join(ownerRoot, name);
  const info = await lstat(file);
  assert.ok(info.isFile() && info.uid === process.getuid() && info.nlink === 1 &&
    !(info.mode & 0o022) && info.size <= 4096, 'Unsafe guest ownership or image record');
  return JSON.parse(await readFile(file, 'utf8'));
}
const owner = await ownedRecord('.owner.json');
assert.equal(owner.kind, 'voxcue-macos-120');
assert.equal(owner.uid, process.getuid());
const toolEnvironment = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  LANG: 'en_US.UTF-8',
  TART_HOME: home,
  TART_NO_AUTO_PRUNE: '1',
};
const source = await ownedRecord('vm-image-source.json');
const cirrusImage = 'ghcr.io/cirruslabs/macos-tahoe-base@sha256:65c3133a633fda8753cf1f71f2d55727792d534a2125b0032466563dcc8e58fd';
const appleImage = 'https://updates.cdn-apple.com/2026FallFCS/c202a724-db7e-4d56-917b-110aa0226507/UniversalMac_27.2.1_26B131_Restore.ipsw';
if (source.reference === appleImage) {
  const ipsw = path.join(ownerRoot, path.basename(new URL(appleImage).pathname));
  const info = await lstat(ipsw);
  assert.ok(info.isFile() && info.uid === process.getuid() && info.nlink === 1 &&
    info.size === 25595954706 && !(info.mode & 0o022), 'Expected the owned Apple restore image');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(ipsw, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  assert.equal(hash.digest('hex'), '233e85a09887579d47d0b195e7db72be7f204261059c6946f719acf6b300814f',
    'Apple restore image differs from the authenticated release');
} else {
  assert.equal(source.reference, cirrusImage, 'Guest image must match the pinned release source');
}
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
  'shared/src/services',
  'shared/electron/contracts',
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
  'macos/native/bin/VoxCue',
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
if (!screenshotOnly && (!runtimeOnly || installOnly)) {
  for (const fromVersion of upgradeVersions)
    await copy(
      await verifiedUpgradeArchive(fromVersion),
      path.join(inputs, 'previous', fromVersion, `VoxCue-${fromVersion}-arm64.zip`),
    );
}
const modelsInput = path.join(inputs, 'components');
if (upgradesOnly) {
  const output = path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components');
  const { packagesFor } = workspace.platformRequire(path.join(output, 'catalog.js'));
  const { componentLocation } = workspace.platformRequire(path.join(output, 'service.js'));
  const rag = packagesFor(process.platform, process.arch).find(item => item.id === 'rag');
  assert.ok(rag, 'Archived knowledge checks require the RAG package');
  await copy(componentLocation(cache, rag), componentLocation(modelsInput, rag));
} else if (!screenshotOnly) {
  await copy(cache, modelsInput);
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
if (${source.reference === appleImage} && cp.execFileSync('/usr/bin/sw_vers',['-buildVersion'],{encoding:'utf8'}).trim()!=='26B131')
  throw Error('The booted guest does not match the verified Apple restore build');
fs.mkdirSync(root,{mode:0o700,recursive:true});
const uuid=cp.execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{encoding:'utf8'}).match(/"IOPlatformUUID"\\s*=\\s*"([A-Fa-f0-9-]+)"/)[1];
fs.writeFileSync(root+'/context.json',JSON.stringify({version:1,root,nonce:${JSON.stringify(nonce)},guestUID:process.getuid(),guestMachineUUID:uuid,hostMachineUUID:${JSON.stringify(hostUUID)},syntheticIPv4:'192.168.248.2'}),{mode:0o600,flag:'wx'});
cp.execFileSync('/usr/bin/ditto',['-x','-k',mount+'/repo.zip',root]);
// The published ZIPs are already compressed. Copy their original bytes to the
// local guest disk and recheck their pins there before extraction.
for(const version of ${JSON.stringify(!screenshotOnly && (!runtimeOnly || installOnly) ? upgradeVersions : [])}) {
  const dir=root+'/repo/macos/release/'+version, name='VoxCue-'+version+'-arm64.zip';
  fs.mkdirSync(dir,{recursive:true});
  fs.copyFileSync(mount+'/previous/'+version+'/'+name,dir+'/'+name,fs.constants.COPYFILE_EXCL);
}
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
  const installation = ['package-smoke.mjs', ['--install-archive', ...selectedUpgrades]];
  const checks = screenshotOnly ? [['package-screenshot-smoke.mjs', []]]
    : upgradesOnly ? [['package-smoke.mjs', ['--upgrades-only', ...selectedUpgrades]]]
    : runtimeOnly ? [
      ['package-dmg-install.mjs', []],
      ['package-runtimes-smoke.mjs', []],
      ['package-screenshot-smoke.mjs', []],
      ['components-smoke.mjs', []],
      ...(installOnly ? [installation] : []),
    ]
    : installOnly ? [installation] : [
      ['package-dmg-install.mjs', []],
      ['package-security-smoke.mjs', []],
      ['package-runtimes-smoke.mjs', []],
      ['package-screenshot-smoke.mjs', []],
      installation,
      ['components-smoke.mjs', []],
    ];
  const failures = [];
  for (const [name, args] of checks) {
    try {
      await guest(
      `const cp=require('node:child_process');
const root=${JSON.stringify(guestRoot)},mount='/Volumes/My Shared Files/voxcue-inputs';
const env={...process.env,VOXCUE_TEST_GUEST_CONTEXT:root+'/context.json',VOXCUE_TEST_RELEASE_DIR:mount+'/release',VOXCUE_TEST_COMPONENT_CACHE:mount+'/components'};
const result=cp.spawnSync(process.execPath,[root+'/repo/macos/test/scripts/'+${JSON.stringify(name)},...${JSON.stringify(args)}],{cwd:root+'/repo/macos',env,stdio:'inherit',timeout:1200000});
if(result.error)throw result.error;process.exitCode=result.status??1;
`,
      1260000,
      );
    } catch (error) {
      requireUnlockedDesktop();
      if (boot.exitCode !== null || boot.signalCode !== null) throw error;
      // Independent product fixtures use separate owner profiles. Preserve
      // each failure without letting an early assertion hide later coverage.
      failures.push(new Error(name, { cause: error }));
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Guest acceptance failed');
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
  'PASS: disposable guest ' + (screenshotOnly ? 'final-ASAR screenshot regression' :
    upgradesOnly ? 'archived-version upgrades' :
    runtimeOnly ? 'DMG installation, packaged AI runtimes, screenshot worker and components' +
      (installOnly ? ', including archived-version upgrades' : '') :
    installOnly ? 'installation and archived-version upgrades' : 'final-product and final-ASAR acceptance') +
  (retainVM ? ' completed; retained guest is stopped for subsequent isolated checks.' : ' completed; guest inputs and profiles removed.'),
);

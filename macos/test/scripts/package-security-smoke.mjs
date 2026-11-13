import { requireGuestIsolation } from './guest-isolation.mjs';
await requireGuestIsolation();
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdir,
  writeFile,
  readFile,
  appendFile,
  cp,
  rm,
  symlink,
  access,
  lstat,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { verifyLocalApp } from '../../scripts/development-signing.mjs';
import { productionFuses } from '../../scripts/production-runtime.mjs';
import { holdDesktopAwake } from './desktop-session.mjs';
import { runGuestProduct } from './guest-product.mjs';

const version = workspace.platformRequire(
  path.join(workspace.platformRoot, 'package.json'),
).version;
const release = process.env.VOXCUE_TEST_RELEASE_DIR;
const pin = workspace.platformRequire(
  path.join(workspace.platformRoot, 'local-signing-public.json'),
);
const original = path.join(testRoot, 'original');
await mkdir(original);
execFileSync('/usr/bin/ditto', [
  '-x',
  '-k',
  path.join(release, `VoxCue-${version}-arm64.zip`),
  original,
]);
const bundle = path.join(original, 'VoxCue.app');
const executable = path.join(bundle, 'Contents/MacOS/VoxCue');
verifyLocalApp(bundle, pin, 'com.voxcue.app');
await productionFuses(
  path.join(bundle, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'),
);
const signing = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', bundle], { encoding: 'utf8' });
assert.match(signing.stderr, /flags=.*\bruntime\b/);
const entitlements = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', bundle], {
  encoding: 'utf8',
});
assert.doesNotMatch(
  entitlements.stdout + entitlements.stderr,
  /allow-dyld-environment-variables|allow-unsigned-executable-memory|get-task-allow/,
);

const marker = path.join(testRoot, 'injection-executed');
const payload = path.join(testRoot, 'injection.cjs');
await writeFile(
  payload,
  `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected');`,
);
const library = path.join(testRoot, 'injection.dylib');
await writeFile(
  library + '.c',
  '#include <stdio.h>\n__attribute__((constructor)) static void loaded(void){FILE *f=fopen(' +
    JSON.stringify(marker) +
    ',"w");if(f){fputs("unexpected",f);fclose(f);}}\n',
);
execFileSync('/usr/bin/xcrun', [
  'clang',
  '-dynamiclib',
  '-arch',
  'arm64',
  library + '.c',
  '-o',
  library,
]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', library]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const present = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const releaseDesktop = holdDesktopAwake();
const normalProfile = path.join(os.homedir(), 'Library/Application Support/VoxCue');
assert.equal(
  await lstat(normalProfile).catch(() => null),
  null,
  'The disposable guest must not already contain a VoxCue profile',
);
async function normal(env = {}, args = []) {
  await runGuestProduct(bundle, {
    env: { ...process.env, ...env },
    args,
    ready: async (pid) => {
      const listeners = spawnSync(
        '/usr/sbin/lsof',
        ['-Pan', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'],
        { encoding: 'utf8' },
      );
      assert.equal(listeners.status, 1, 'The browser must expose no inspector/CDP listener');
      assert.equal(await present(marker), false, 'Startup must ignore Node and DYLD injection');
    },
  });
}
try {
  await normal();
  await normal(
    {
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require=' + payload,
      DYLD_INSERT_LIBRARIES: library,
    },
    ['-e', await readFile(payload, 'utf8')],
  );
  await runGuestProduct(bundle, {
    probeSignal: 'SIGUSR1',
    ready: (pid) => {
      assert.equal(
        spawnSync('/usr/sbin/lsof', ['-Pan', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'], {
          encoding: 'utf8',
        }).status,
        1,
        'SIGUSR1 must not activate an inspector',
      );
    },
  });
  for (const args of [
    ['--remote-debugging-port=0'],
    ['--remote-debugging-port', '9222'],
    ['-remote-debugging-port=9333'],
    ['--REMOTE-DEBUGGING-PORT=0'],
    ['--remote-debugging-pipe'],
    ['--inspect=0'],
    ['--inspect-brk=0'],
    ['--auto-open-devtools-for-tabs'],
    ['--type=utility'],
    ['--no-sandbox'],
    ['--disable-web-security'],
    ['--ignore-certificate-errors'],
  ]) {
    const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 64, JSON.stringify(args) + result.stderr);
    assert.match(result.stderr, /unsafe production arguments are disabled/);
  }
  console.log(
    'PASS: untouched final executable cold start, native Quit/drain, HR, fuses and pre-bootstrap debugging/env rejection.',
  );
  assert.equal(
    spawnSync(
      path.join(bundle, 'Contents/Resources/native/VoxCue.Integrity'),
      [String(process.pid)],
      { encoding: 'utf8', timeout: 120000 },
    ).status,
    0,
    'The unchanged signed runtime must pass the same verifier used before MLX',
  );
  for (const relative of [
    'Contents/Resources/app.asar',
    'Contents/Resources/native/qwen/mlx-worker.py',
    'Contents/Resources/native/qwen/python/bin/python3.12',
    'Contents/Resources/native/qwen/python/lib/python3.12/site-packages/mlx_qwen3_asr/load_models.py',
  ]) {
    const directory = path.join(testRoot, 'tamper-' + path.basename(relative));
    const changed = path.join(directory, 'VoxCue.app');
    await mkdir(directory);
    await cp(bundle, changed, { recursive: true, verbatimSymlinks: true });
    await appendFile(path.join(changed, relative), '\nunsigned synthetic tamper\n');
    for (const target of ['Contents/MacOS/VoxCue', 'Contents/Resources/native/VoxCue.Integrity'])
      assert.equal(
        spawnSync(
          path.join(changed, target),
          target.endsWith('VoxCue.Integrity') ? [String(process.pid)] : [],
          { encoding: 'utf8', timeout: 120000 },
        ).status,
        78,
        relative,
      );
    await rm(directory, { recursive: true, force: true });
  }
  const redirected = path.join(testRoot, 'redirected/VoxCue.app');
  await cp(bundle, redirected, { recursive: true, verbatimSymlinks: true });
  const script = path.join(redirected, 'Contents/Resources/native/qwen/mlx-worker.py');
  await rm(script);
  await symlink(payload, script);
  assert.equal(
    spawnSync(
      path.join(redirected, 'Contents/Resources/native/VoxCue.Integrity'),
      [String(process.pid)],
      {
        encoding: 'utf8',
        timeout: 120000,
      },
    ).status,
    78,
  );
  await rm(path.dirname(redirected), { recursive: true, force: true });
  console.log(
    'PASS: final ASAR, Python, MLX script and redirected-resource tampering fail pinned sealed-resource verification.',
  );
  // Direct launch must be protected even outside the sanitized app adapter.
  const credentials = spawnSync(
    path.join(bundle, 'Contents/Resources/native/VoxCue'),
    [],
    {
      env: { ...process.env, DYLD_INSERT_LIBRARIES: library },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.ok(!credentials.error);
  assert.equal(credentials.status, 77);
  const injected = await present(marker);
  await rm(marker, { force: true });
  assert.equal(injected, false, 'Hardened credential helper must reject direct DYLD injection');
  console.log(
    'PASS: fixed hardened Credentials helper rejects unrelated parent and direct DYLD injection; no credential operation requested.',
  );
  // Dedicated credential ingress fixture, not an ordinary GUI account fixture.
  // Invalid ciphertext is rejected before passwordForOperation/Keychain access.
  const ingress = path.join(testRoot, 'credential-ingress.cjs');
  const host = path.join(workspace.platformRoot, '.tools/electron-dev/Electron.app');
  verifyLocalApp(host, pin, 'com.voxcue.development', { strict: false });
  await writeFile(
    ingress,
    `const {app}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs');
const profile=${JSON.stringify(path.join(testRoot, 'credential-profile'))};fs.mkdirSync(profile,{recursive:true,mode:0o700});
app.setPath('appData',profile);app.setPath('userData',profile);app.setPath('sessionData',profile);
app.whenReady().then(async()=>{
 process.env.DYLD_INSERT_LIBRARIES=${JSON.stringify(library)};
 process.env.NODE_OPTIONS=${JSON.stringify('--require=' + payload)};
 const {createCredentialEncryption}=require(${JSON.stringify(path.join(bundle, 'Contents/Resources/app.asar/dist-electron/macos/electron/credentials.js'))});
 await assert.rejects(createCredentialEncryption(${JSON.stringify(path.join(bundle, 'Contents/Resources/native/VoxCue'))}).decrypt(Buffer.from('invalid')));
 assert.equal(fs.existsSync(${JSON.stringify(marker)}),false,'The actual helper launch must not inherit the injected environment');
 console.log('PASS: final ASAR credential launcher rejects inherited DYLD/Node injection with the exact fixed helper; invalid input reaches no Keychain operation.');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});`,
  );
  const child = spawnTestProcess(path.join(host, 'Contents/MacOS/Electron'), [ingress], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      NODE_OPTIONS: undefined,
      DYLD_INSERT_LIBRARIES: undefined,
    },
    stdio: 'inherit',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  try {
    assert.equal(await new Promise((resolve) => child.once('close', resolve)), 0);
  } finally {
    clearTimeout(timer);
  }
} finally {
  releaseDesktop();
  let released = false;
  for (let i = 0; i < 40; i++) {
    const inventory = execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' });
    if (!inventory.split('\n').some((line) => line.trim().startsWith(bundle + '/'))) {
      released = true;
      break;
    }
    await delay(250);
  }
  if (released) await rm(normalProfile, { recursive: true, force: true });
}

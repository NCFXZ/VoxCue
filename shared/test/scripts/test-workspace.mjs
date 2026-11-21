import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import workspace from '../../scripts/workspace.mjs';
import {
  assertOwnerElectronLaunch, packagedGuiIsolationMessage, verifySyntheticElectronPackage,
  syntheticElectronEntry, syntheticElectronHtml,
} from './electron-launch-policy.mjs';

const temporary = fs.realpathSync(os.tmpdir());
const prefix = 'voxcue-test-run-';
const marker = '.voxcue-test-owner.json';
// Recover only our own abandoned temporary runs, never workspace/user directories.
for (const name of fs.readdirSync(temporary)) {
  if (!name.startsWith(prefix)) continue;
  const directory = path.join(temporary, name);
  try {
    if (fs.lstatSync(directory).isSymbolicLink()) continue;
    const owner = JSON.parse(fs.readFileSync(path.join(directory, marker), 'utf8'));
    if (owner.kind !== prefix || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) continue;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        const liveChild = (owner.children ?? []).some((pid) => {
          if (!Number.isSafeInteger(pid) || pid <= 0) return true;
          try {
            process.kill(pid, 0);
            return true;
          } catch (error) {
            return error.code !== 'ESRCH';
          }
        });
        if (!liveChild) fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  } catch {
    // Unknown directories do not grant us deletion authority.
  }
}
export const testRoot = fs.mkdtempSync(path.join(temporary, prefix));
const defaultHost = workspace.platformRequire('electron');
const macDevelopmentHost = path.join(workspace.platformRoot, '.tools/electron-dev/Electron.app/Contents/MacOS/Electron');
const macSigning = process.platform === 'darwin'
  ? await import(pathToFileURL(path.join(workspace.platformRoot, 'scripts/development-signing.mjs')).href)
  : undefined;
const launchPolicy = {
  testRoot, platformRoot: workspace.platformRoot, defaultHost,
  developmentHosts: [
    { path: defaultHost },
    ...(process.platform === 'darwin' ? [
      { path: macDevelopmentHost, identifier: 'com.voxcue.development' },
    ] : []),
  ],
  syntheticPackages: new Map(),
  verifyDevelopmentHost(host) {
    if (!host.identifier) return;
    const pin = JSON.parse(fs.readFileSync(path.join(workspace.platformRoot, 'local-signing-public.json'), 'utf8'));
    if (pin.version !== 1 || !/^[a-f0-9]{40}$/i.test(pin.sha1)) throw Error('Invalid development signing pin');
    const app = path.resolve(host.path, '../../..');
    // Existing workspace hosts tolerate File Provider FinderInfo, exactly as
    // prepareRuntime does; their sealed code and fixed identity are still verified.
    macSigning.verifyLocalApp(app, pin, host.identifier, { strict: false });
  },
};
export { syntheticElectronEntry, syntheticElectronHtml };
export function registerSyntheticElectronFixture(executable, profile) {
  verifySyntheticElectronPackage(executable, profile, launchPolicy);
  launchPolicy.syntheticPackages.set(path.resolve(executable), profile);
}
const children = new Set();
let cleaned = false;
let stopping = false;
const recordOwner = () => {
  if (!cleaned)
    fs.writeFileSync(
      path.join(testRoot, marker),
      JSON.stringify({
        kind: prefix,
        pid: process.pid,
        children: [...children]
          .map((child) => child.pid)
          .filter((pid) => Number.isSafeInteger(pid)),
      }),
    );
};
recordOwner();
export function trackTestProcess(child) {
  if (process.platform === 'win32') {
    const kill = child.kill.bind(child);
    // Windows kills only the direct process for SIGTERM/SIGKILL. A timed-out
    // fixture must also release its own Electron renderer/utility children.
    child.kill = (signal) => {
      if (child.exitCode !== null || child.signalCode !== null) return false;
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 10000,
        });
        return true;
      } catch {
        return kill(signal);
      }
    };
  }
  children.add(child);
  recordOwner();
  child.once('close', () => {
    children.delete(child);
    recordOwner();
  });
  return child;
}
export function spawnTestProcess(command, args, options) {
  if (stopping) throw Error('The owned test run is stopping');
  if (process.platform === 'darwin' && command.includes(path.sep)) {
    const product = path.join(workspace.platformRoot, 'VoxCue.app/Contents/MacOS/VoxCue');
    const target = path.resolve(options?.cwd ?? process.cwd(), command);
    if (target === product ||
        (fs.existsSync(product) && fs.existsSync(target) && fs.realpathSync(target) === fs.realpathSync(product)))
      throw Error(packagedGuiIsolationMessage);
  }
  // Native-only fixtures need the same fixed, signed Mac host as UI fixtures.
  // Keep packaged executables and Electron's Node-mode ABI checks untouched.
  const developmentHost = path.join(
    workspace.platformRoot,
    '.tools/electron-dev/Electron.app/Contents/MacOS/Electron',
  );
  if (
    process.platform === 'darwin' &&
    command === workspace.platformRequire('electron') &&
    (options?.env ?? process.env).ELECTRON_RUN_AS_NODE !== '1' &&
    fs.existsSync(developmentHost)
  )
    command = developmentHost;
  return trackTestProcess(spawn(command, args, options));
}
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of children) child.kill('SIGKILL');
  // A sent signal is not proof of exit. Keep the owner marker/profile while a
  // child is still alive; the next run's existing orphan recovery reaps it only
  // after both the owner and every recorded child have actually disappeared.
  if ([...children].some(child => {
    if (!Number.isSafeInteger(child.pid)) return true;
    try { process.kill(child.pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
  })) return;
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
process.once('exit', cleanup);
async function interrupt(code) {
  if (stopping) return;
  stopping = true;
  // Let a nested Node suite retire its own Electron/native children. SIGKILL
  // of the suite itself would skip its owner cleanup and orphan those children.
  await Promise.all([...children].map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const finish = () => { clearTimeout(timer); child.removeListener('close', finish); resolve(); };
    const timer = setTimeout(finish, 10000);
    child.once('close', finish);
    child.kill('SIGTERM');
  })));
  cleanup();
  process.exit(code);
}
process.once('SIGINT', () => { void interrupt(130); });
process.once('SIGTERM', () => { void interrupt(143); });

export const electron = {
  async launch(options) {
    if (stopping) throw Error('The owned test run is stopping');
    // Fixtures declare their owned HTTP origin explicitly; ordinary UI and packages stay offline.
    options={...options,env:{...(options.env??process.env),COPILOT_TEST_USER_DATA:options.env?.COPILOT_TEST_USER_DATA||path.join(testRoot,'profile'),VOXCUE_ACCOUNT_API:options.env?.VOXCUE_ACCOUNT_API??''}};
    if (process.platform === 'darwin' && !options.executablePath && fs.existsSync(macDevelopmentHost))
      options = { ...options, executablePath: macDevelopmentHost };
    assertOwnerElectronLaunch(options, launchPolicy);
    const probe=process.platform==='win32' ? (await import(pathToFileURL(path.join(workspace.platformRoot,'test/scripts/window-probe.mjs')).href)).probe : undefined;
    if(probe && !probe('desktop').interactive) throw Error('GUI verification requires an unlocked input desktop');
    const desktop = process.platform === 'darwin'
      ? await import(pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/desktop-session.mjs')).href)
      : undefined;
    desktop?.requireUnlockedDesktop();
    const profile = options.env?.COPILOT_TEST_USER_DATA;
    const isolatedArgument = options.args?.some((value) =>
      path.resolve(value).startsWith(testRoot + path.sep),
    );
    if (!(profile && path.resolve(profile).startsWith(testRoot + path.sep)) && !isolatedArgument)
      throw Error('Electron tests require this run’s temporary userData or fixture entry.');
    // Legacy development checks share the same pre-import network boundary.
    // Keep explicit Vite previews and packaged download fixtures on their own
    // transports; their callers own those narrower network fixtures.
    const entryArgument = options.args?.[0];
    if (
      entryArgument &&
      !options.env?.VITE_DEV_SERVER_URL &&
      path.basename(entryArgument) !== 'offline-electron-entry.cjs' &&
      (path.resolve(entryArgument) === workspace.platformRoot ||
        path.resolve(entryArgument).startsWith(testRoot + path.sep))
    ) {
      const { offlineElectronEntry } = await import('./offline-electron-entry.mjs');
      const fixture =
        path.resolve(entryArgument) === workspace.platformRoot ? undefined : entryArgument;
      options = {
        ...options,
        args: [
          await offlineElectronEntry(fixture, {
            loopbackPort: options.env?.VOXCUE_TEST_LOOPBACK_PORT
              ? Number(options.env.VOXCUE_TEST_LOOPBACK_PORT)
              : undefined,
          }),
          ...options.args.slice(1),
        ],
      };
    }
    const speechModels = options.env?.VOXCUE_TEST_SPEECH_MODELS;
    const ragModel = options.env?.VOXCUE_TEST_RAG_MODEL;
    if (speechModels && ragModel && options.args?.[0]) {
      // Inject only development resource paths in the isolated host, before main loads.
      // Packaged tests have no entry argument and exercise the real component cache.
      for (const directory of [speechModels, ragModel]) {
        const actual = fs.realpathSync(directory);
        const run = path.relative(temporary, actual).split(path.sep)[0];
        if (!run.startsWith(prefix) || !fs.existsSync(path.join(temporary, run, marker)))
          throw Error('Model fixtures must belong to a temporary test run');
      }
      const entry = path.resolve(options.args[0]);
      const wrapper = path.join(testRoot, 'model-entry-' + Date.now() + '.cjs');
      fs.writeFileSync(
        wrapper,
        `
const {app}=require('electron');
app.setAppPath(${JSON.stringify(workspace.platformRoot)});
const platform=require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/platform/index.js'))});
const resources=platform.desktopResources;
platform.desktopResources=(...args)=>({...resources(...args),speechModels:${JSON.stringify(speechModels)},ragModel:${JSON.stringify(ragModel)}});
require(${JSON.stringify(entry)});
`,
      );
      options = { ...options, args: [wrapper, ...options.args.slice(1)] };
    }
    const executable = path.join(
      workspace.platformRoot,
      '.tools/electron-dev/Electron.app/Contents/MacOS/Electron',
    );
    const scale = options.env?.VOXCUE_TEST_SCALE_FACTOR;
    if (scale) {
      if (
        !['win32', 'darwin'].includes(process.platform) ||
        !['1', '1.25', '1.5', '1.75', '2'].includes(scale)
      )
        throw Error('Unsupported isolated desktop scale factor');
      options = {
        ...options,
        args: [...(options.args ?? []), '--force-device-scale-factor=' + scale],
      };
    }
    const app = await workspace.platformRequire('playwright')._electron.launch({
      ...(process.platform === 'darwin' && fs.existsSync(executable)
        ? { executablePath: executable } : {}),
      ...options,
    });
    trackTestProcess(app.process());
    if(probe || desktop) {
      const guard=setInterval(()=>{
        try {
          desktop?.requireUnlockedDesktop();
          if(probe && !probe('desktop').interactive) throw Error('Desktop locked; GUI verification stopped');
        }
        catch(error){console.error(error.message);app.process().kill('SIGTERM');}
      },2000);
      guard.unref();
      app.process().once('exit',()=>clearInterval(guard));
    }
    return app;
  },
};

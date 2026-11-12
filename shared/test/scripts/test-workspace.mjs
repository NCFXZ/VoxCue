import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import workspace from '../../scripts/workspace.mjs';
import {
  assertOwnerElectronLaunch, verifySyntheticElectronPackage,
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
const macDevelopmentLauncher = path.join(workspace.platformRoot, 'VoxCue.app/Contents/MacOS/VoxCue');
const launchPolicy = {
  testRoot, platformRoot: workspace.platformRoot, defaultHost,
  developmentHosts: [
    { path: defaultHost },
    ...(process.platform === 'darwin' ? [
      { path: macDevelopmentHost, identifier: 'com.voxcue.development' },
      { path: macDevelopmentLauncher, identifier: 'com.voxcue.launcher', launcher: true },
    ] : []),
  ],
  syntheticPackages: new Map(),
  verifyDevelopmentHost(host) {
    if (!host.identifier) return;
    const pin = JSON.parse(fs.readFileSync(path.join(workspace.platformRoot, 'local-signing-public.json'), 'utf8'));
    if (pin.version !== 1 || !/^[a-f0-9]{40}$/i.test(pin.sha1)) throw Error('Invalid development signing pin');
    const app = path.resolve(host.path, '../../..');
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', '-R',
      `identifier "${host.identifier}" and certificate leaf = H"${pin.sha1}"`, app],
    { stdio: 'pipe', timeout: 10000 });
  },
};
export { syntheticElectronEntry, syntheticElectronHtml };
export function registerSyntheticElectronFixture(executable, profile) {
  verifySyntheticElectronPackage(executable, profile, launchPolicy);
  launchPolicy.syntheticPackages.set(path.resolve(executable), profile);
}
const children = new Set();
let cleaned = false;
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
  child.once('exit', () => {
    children.delete(child);
    recordOwner();
  });
  return child;
}
export function spawnTestProcess(command, args, options) {
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
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
process.once('exit', cleanup);
process.once('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.once('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

export const electron = {
  async launch(options) {
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
    // Packaged UI must never launch an account-owning runtime before synthetic ports install.
    // Exclusive read handles block process creation without changing any release/SDK bytes.
    let releaseCredentials=async()=>{};
    if(process.platform==='win32' && options.executablePath && path.basename(options.executablePath).toLowerCase()==='voxcue.exe') {
      const unpacked=path.join(path.dirname(options.executablePath),'resources/app.asar.unpacked/node_modules');
      const files=[path.join(unpacked,'@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),path.join(unpacked,'@github/copilot-sdk-win32-x64/prebuilds/win32-x64/copilot-runtime.exe')];
      if(files.some(file=>!fs.existsSync(file))) throw Error('Packaged credential runtime guard cannot resolve the pinned SDK executables');
      if(files.length) {
        const {holdExclusiveFiles}=await import(pathToFileURL(path.join(workspace.platformRoot,'test/scripts/window-probe.mjs')).href);
        releaseCredentials=await holdExclusiveFiles(files);
      }
    }
    if (desktop && options.executablePath?.endsWith("/Contents/MacOS/VoxCue")) {
      const developmentLauncher =
        options.executablePath ===
        path.join(workspace.platformRoot, "VoxCue.app/Contents/MacOS/VoxCue");
      if (developmentLauncher) {
        const { offlineElectronEntry } =
          await import("./offline-electron-entry.mjs");
        options = {
          ...options,
          args: [
            await offlineElectronEntry(undefined, { deferToReady: true }),
            ...(options.args ?? []),
            "--use-mock-keychain",
          ],
        };
      } else {
        const resources = path.resolve(
          path.dirname(options.executablePath),
          "../Resources",
        );
        const unpacked = path.join(resources, "app.asar.unpacked/node_modules");
        const files = [
          path.join(resources, "native/VoxCue.Credentials"),
          path.join(
            unpacked,
            "@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
          ),
          path.join(
            unpacked,
            "@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/copilot-runtime",
          ),
        ].map((file) => {
          const actual = fs.realpathSync(file),
            stat = fs.statSync(actual);
          if (
            !actual.startsWith(testRoot + path.sep) ||
            !stat.isFile() ||
            stat.uid !== process.getuid() ||
            stat.nlink !== 1
          )
            throw Error(
              "Mac execution guard requires private copies in this owned temporary run",
            );
          return { file: actual, mode: stat.mode & 0o777 };
        });
        let restored = false;
        releaseCredentials = async () => {
          if (restored) return;
          restored = true;
          for (const { file, mode } of files) {
            try {
              fs.chmodSync(file, mode);
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          }
        };
        try {
          for (const { file, mode } of files) {
            fs.chmodSync(file, mode & ~0o111);
            try {
              fs.accessSync(file, fs.constants.X_OK);
            } catch (error) {
              if (error.code === "EACCES") continue;
              throw error;
            }
            throw Error("Mac packaged credential executable remains runnable");
          }
        } catch (error) {
          await releaseCredentials();
          throw error;
        }
        // Only executable modes of owned copies change; signed bytes and Chromium sandbox stay intact.
        options = {
          ...options,
          args: [...(options.args ?? []), "--use-mock-keychain"],
        };
      }
    }
    let app;
    try {app = await workspace.platformRequire('playwright')._electron.launch({
      ...(process.platform === 'darwin' && fs.existsSync(executable)
        ? { executablePath: executable }
        : {}),
      ...options,
    });} catch(error) {await releaseCredentials();throw error;}
    app.process().once('exit',()=>{void releaseCredentials().catch(error=>console.error(error.message));});
    const close = app.close.bind(app);
    app.close = async (...args) => {
      try { return await close(...args); }
      finally { await releaseCredentials(); }
    };
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

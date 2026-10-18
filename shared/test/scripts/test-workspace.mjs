import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import workspace from '../../scripts/workspace.mjs';

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
  children.add(child);
  recordOwner();
  child.once('exit', () => {
    children.delete(child);
    recordOwner();
  });
  return child;
}
export function spawnTestProcess(...args) {
  return trackTestProcess(spawn(...args));
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
    const profile = options.env?.COPILOT_TEST_USER_DATA;
    const isolatedArgument = options.args?.some((value) =>
      path.resolve(value).startsWith(testRoot + path.sep),
    );
    if (!(profile && path.resolve(profile).startsWith(testRoot + path.sep)) && !isolatedArgument)
      throw Error('Electron tests require this run’s temporary userData or fixture entry.');
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
    const app = await workspace.platformRequire('playwright')._electron.launch({
      ...(process.platform === 'darwin' && fs.existsSync(executable)
        ? { executablePath: executable }
        : {}),
      ...options,
    });
    trackTestProcess(app.process());
    return app;
  },
};

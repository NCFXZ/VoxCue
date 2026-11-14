import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../../shared/scripts/workspace.mjs';
import { watchTestDesktop } from '../../../shared/test/scripts/desktop-guard.mjs';
import { spawnTestProcess, testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { probe } from './window-probe.mjs';

const requireDesktop = () =>
  assert.equal(probe('desktop').interactive, true, 'The unlocked owner console is required');
requireDesktop();
const profile = path.join(testRoot, 'profile');
const entry = path.join(testRoot, 'account-network.cjs');
await mkdir(profile);
await copyFile(new URL('../fixtures/account-network.cjs', import.meta.url), entry);
const ts = workspace.platformRequire('typescript');
const source = await readFile(new URL('../../electron/accountNetwork.ts', import.meta.url), 'utf8');
await writeFile(
  path.join(testRoot, 'accountNetwork.cjs'),
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
const child = spawnTestProcess(
  workspace.platformRequire('electron'),
  [entry, '--user-data-dir=' + profile],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    windowsHide: true,
    stdio: 'inherit',
  },
);
const guard = watchTestDesktop(child, requireDesktop);
const timer = setTimeout(() => child.kill(), 45000);
try {
  const [code] = await once(child, 'close');
  if (guard.failure) throw guard.failure;
  assert.equal(code, 0, 'The isolated Electron account network check failed');
} finally {
  clearTimeout(timer);
  guard.release();
}

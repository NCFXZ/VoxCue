import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { requireUnlockedDesktop } from './desktop-session.mjs';

const probe = path.join(testRoot, 'save-dialog-probe.node');
execFileSync('/usr/bin/xcrun', [
  'clang++',
  '-std=c++17',
  '-fobjc-arc',
  '-DNAPI_VERSION=8',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-arch',
  'arm64',
  '-mmacosx-version-min=14.2',
  '-I',
  path.join(workspace.platformRoot, '.cache/node-api-headers'),
  path.join(workspace.platformRoot, 'test/fixtures/save-dialog-probe.mm'),
  '-framework',
  'AppKit',
  '-framework',
  'CoreGraphics',
  '-o',
  probe,
]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', probe], { stdio: 'pipe' });

export async function nativeSaveDialog(app, { cancel, target, overwrite = false }) {
  requireUnlockedDesktop();
  assert.equal(await realpath(path.dirname(target)), path.dirname(target));
  assert.ok(target.startsWith(testRoot + path.sep), 'Native save target must belong to this run');
  const call = (action) =>
    app.evaluate(
      ({ app }, { probe, action, root }) => {
        if (!app.getPath('userData').startsWith(root + '/'))
          throw Error('Synthetic profile required');
        const require = process
          .getBuiltinModule('module')
          .createRequire(app.getAppPath() + '/package.json');
        return JSON.parse(require(probe).probe(action));
      },
      { probe, action, root: testRoot },
    );
  const until = async (key, expected = true, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    let state;
    do {
      requireUnlockedDesktop();
      state = await call('inspect');
      if (state[key] === expected) return state;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw Error('Native save sheet did not reach ' + key + ': ' + JSON.stringify(state));
  };
  const state = await until('nativeSaveDialog');
  assert.equal(state.title, '导出资料');
  if (cancel) {
    await call('cancel');
    console.log('PASS owned Mac NSSavePanel cancel');
    return;
  }
  const before = overwrite ? await readFile(target) : undefined;
  if (before)
    assert.deepEqual(
      await readFile(target),
      before,
      'Selecting an existing ZIP must preserve it until confirmation',
    );
  console.log(
    'ACTION_REQUIRED: click Save in the owned native sheet' +
      (overwrite
        ? ', then confirm Replace for the existing synthetic ZIP.'
        : ' for the selected Chinese filename.'),
  );
  await until('nativeSaveDialog', false, 120000);
  console.log(
    'Observed owned Mac NSSavePanel close for Chinese path' +
      (overwrite ? ' and replacement confirmation' : ' selection'),
  );
}

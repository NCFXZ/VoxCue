import path from 'node:path';
import { execFileSync } from 'node:child_process';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { requireUnlockedDesktop } from './desktop-session.mjs';
import { focusUiWindow } from '../../../shared/test/scripts/install-ui-account.mjs';

const probe = path.join(testRoot, 'shortcut-input-probe.node');
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
  path.join(workspace.platformRoot, 'test/fixtures/shortcut-input-probe.mm'),
  '-framework',
  'AppKit',
  '-o',
  probe,
]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', probe], { stdio: 'pipe' });

export async function nativeShortcut(app, chord) {
  requireUnlockedDesktop();
  await focusUiWindow(app, await app.firstWindow());
  await app.evaluate(
    async ({ app }, { probe, chord, root }) => {
      if (!app.getPath('userData').startsWith(root + '/'))
        throw Error('Synthetic profile required');
      const load = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const input = load(probe),
        deadline = Date.now() + 3000;
      while (!input.press('inspect') && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      input.press(chord);
    },
    { probe, chord, root: testRoot },
  );
}

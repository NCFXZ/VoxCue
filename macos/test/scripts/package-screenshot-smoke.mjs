import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { verifyLocalApp } from '../../scripts/development-signing.mjs';
import { requireGuestIsolation } from './guest-isolation.mjs';
import { launchGuestAsar } from './guest-asar-host.mjs';
import { holdDesktopAwake } from './desktop-session.mjs';

await requireGuestIsolation();
if (process.argv.length !== 2) throw Error('Screenshot acceptance only runs through the disposable guest runner.');
const pin = JSON.parse(await readFile(path.join(workspace.platformRoot, 'local-signing-public.json'), 'utf8'));
const version = JSON.parse(await readFile(path.join(workspace.sharedRoot, 'package.json'), 'utf8')).version;
const release = process.env.VOXCUE_TEST_RELEASE_DIR || path.join(workspace.platformRoot, 'release', version);
const destination = path.join(testRoot, 'screenshot-installed');
await mkdir(destination);
execFileSync('/usr/bin/ditto', ['-x', '-k', path.join(release, `VoxCue-${version}-arm64.zip`), destination]);
const bundle = path.join(destination, 'VoxCue.app');
verifyLocalApp(bundle, pin, 'com.voxcue.app');
const releaseDesktop = holdDesktopAwake();
let app;
try {
  app = await launchGuestAsar(bundle, {
    env: { ...process.env, COPILOT_TEST_USER_DATA: path.join(testRoot, 'VoxCue') },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const result = await app.evaluate(async ({ app }, checks) => {
    const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    return load(checks)({ runtimeRoot: app.getAppPath() });
  }, path.join(workspace.sharedRoot, 'test/scripts/screenshot-worker-checks.cjs'));
  verifyLocalApp(bundle, pin, 'com.voxcue.app');
  console.log('PASS: signed final ASAR screenshot-only regression; synthetic pixels, continuous encoding/RSS plateau, error/cancel/load/real deadline and actual Worker exits.', result);
} finally {
  try { if (app) await closeUiApp(app); }
  finally { releaseDesktop(); }
}

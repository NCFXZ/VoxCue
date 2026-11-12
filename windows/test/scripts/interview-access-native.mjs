import { electron, testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
if (process.argv.length !== 3 || process.argv[2] !== '--hardware-audio')
  throw Error(
    'Physical audio is opt-in: confirm the current scope, then pass only --hardware-audio.',
  );
const profile = path.join(testRoot, 'interview-access-native');
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
await writeFile(
  fixture,
  `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});app.whenReady().then(()=>{});`,
);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [fixture], env });
try {
  const report = await app.evaluate(async ({ systemPreferences }, root) => {
    const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
    const path = require('node:path');
    const { InterviewAccess } = require(
      path.join(root, 'dist-electron/windows/electron/speech/access.js'),
    );
    const { devices, probeDevice } = require(
      path.join(root, 'dist-electron/windows/electron/speech/capture.js'),
    );
    const helper = path.join(root, 'native/bin/VoxCue.Audio.exe');
    const permission = systemPreferences.getMediaAccessStatus('microphone');
    const access = new InterviewAccess({
      platform: process.platform,
      microphonePermission: () => permission,
      devices: () => devices(helper),
      probe: (source, device) => probeDevice(helper, source, device),
    });
    const both = await access.check({ sources: ['system', 'microphone'] });
    const system = await access.check({ sources: ['system'] });
    const missing = await access.check({
      sources: ['system'],
      system: 'nonexistent-synthetic-endpoint',
    });
    return {
      permission,
      both: { ready: both.ready, checks: both.checks },
      system: { ready: system.ready, checks: system.checks },
      missing: { ready: missing.ready, checks: missing.checks },
    };
  }, process.cwd());
  assert.equal(report.missing.ready, false);
  assert.equal(report.system.checks.length, 1);
  assert.equal(
    report.both.ready,
    report.both.checks.every((check) => check.status === 'granted'),
  );
  console.log(JSON.stringify({ profile, ...report }, null, 2));
} finally {
  await app.close();
}

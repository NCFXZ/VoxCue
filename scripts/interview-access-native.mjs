import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve('test-results', `interview-access-native-${Date.now()}`);
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
await writeFile(
  fixture,
  `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [fixture], env });
try {
  const report = await app.evaluate(async ({ systemPreferences }, root) => {
    const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
    const path = require('node:path');
    const { InterviewAccess } = require(path.join(root, 'dist-electron/backend/speech/access.js'));
    const { devices, probeDevice } = require(
      path.join(root, 'dist-electron/backend/speech/capture.js'),
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
  await writeFile(path.join(profile, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ profile, ...report }, null, 2));
} finally {
  await app.close();
}

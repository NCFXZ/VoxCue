import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { prepareSpeechFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import assert from 'node:assert/strict';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import installerConfig from '../../electron-builder.config.cjs';
import { prepareInstallerUi } from '../../scripts/build-installer-ui.mjs';
import { verifyPreviousVersionData } from './package-upgrade-data.mjs';

assert.equal(process.platform, 'win32');
const installerStage = process.argv.includes('--installer-stage');
const output = path.join(testRoot, 'platform-layout-portable'),
  fixtures = await prepareSpeechFixtures();
async function run(file, args, timeout) {
  const child = spawnTestProcess(process.execPath, [file, ...args], {
    env: { ...process.env, VOXCUE_SPEECH_FIXTURE_DIR: fixtures },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  const timer = setTimeout(() => child.kill(), timeout);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, file + ' failed');
}
if (!installerStage) await run('scripts/package-portable.mjs', ['--test-output=' + output], 600000);
if (process.argv.includes('--with-installer')) {
  assert.equal(installerStage, false);
  process.env.ELECTRON_BUILDER_CACHE = path.resolve('.cache/electron-builder');
  const stage = path.join(output, 'VoxCue-win32-x64');
  const [source] = installerConfig.publish;
  assert.equal(source.owner + '/' + source.repo, 'NCFXZ/VoxCue-releases');
  await writeFile(
    path.join(stage, 'resources/app-update.yml'),
    JSON.stringify({
      provider: source.provider,
      owner: source.owner,
      repo: source.repo,
      private: false,
      updaterCacheDirName: 'voxcue-updater',
    }),
  );
  const temporary = path.join(testRoot, 'builder-tmp');
  await mkdir(temporary);
  const originalTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TEMP = temporary;
  process.env.TMP = temporary;
  try {
    const { build, Platform, Arch } = await import('electron-builder');
    await build({
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
      prepackaged: stage,
      config: {
        ...installerConfig,
        directories: { output: path.join(testRoot, 'installer') },
        nsis: {
          ...installerConfig.nsis,
          include: (await prepareInstallerUi(path.join(testRoot, 'installer-ui'))).include,
        },
      },
      publish: 'never',
    });
  } finally {
    for (const [name, value] of Object.entries(originalTemp)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  await run('test/scripts/installer-artifact-smoke.mjs', ['--test-release=' + testRoot], 240000);
}
const packageArgs = installerStage
  ? ['--installer-stage']
  : ['--test-package=' + path.join(output, 'VoxCue-win32-x64')];
await run('test/scripts/packaged-smoke.mjs', packageArgs, 180000);
await run('test/scripts/presentation-native-smoke.mjs', packageArgs, 180000);
if (installerStage)
  await verifyPreviousVersionData({
    currentPackage: path.resolve('release/installer-stage/VoxCue-win32-x64'),
    cache: process.env.VOXCUE_TEST_COMPONENT_CACHE ?? path.resolve('.cache/test-components'),
  });
console.log(
  JSON.stringify({
    status: 'passed',
    package: installerStage ? 'installer-stage' : 'isolated-portable',
    installed: false,
    published: false,
  }),
);

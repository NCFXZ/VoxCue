import assert from 'node:assert/strict';
import { build, Platform, Arch } from 'electron-builder';
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  realpath,
  symlink,
  unlink,
  copyFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { prepareInstallerUi } from '../../scripts/build-installer-ui.mjs';
import config from '../../electron-builder.config.cjs';

assert.equal(process.platform, 'win32');
const previousVersion = '0.3.0';
const currentVersion = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).version;
assert.notEqual(
  currentVersion,
  previousVersion,
  'Upgrade fixture must target the current Windows version',
);
const guid = randomUUID();
const name = 'VoxCueInstallTest-' + guid;
const project = path.join(testRoot, 'project');
const stage = path.join(testRoot, 'stage');
const defaultTarget = path.join(testRoot, 'default installation');
const chosenParent = path.join(testRoot, '自选安装目录 with spaces');
const target = path.join(chosenParent, 'VoxCue');
const ignoredTarget = path.join(testRoot, 'must-not-move');
const temporary = path.join(testRoot, 'nsis-tmp');
const data = path.join(testRoot, 'profile/VoxCue');
const legacyData = path.join(testRoot, 'profile/ai-interview-copilot');
for (const directory of [project, stage, defaultTarget, chosenParent, temporary])
  await mkdir(directory);
await mkdir(path.join(stage, 'resources'));
process.env.TEMP = temporary;
process.env.TMP = temporary;
process.env.ELECTRON_BUILDER_CACHE = path.resolve('.cache/electron-builder');
const env = { ...process.env };
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
function compile(args) {
  const result = spawnSync(compiler, ['/nologo', '/utf8output', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
}
const probe = path.join(testRoot, 'InstallerProbe.exe');
compile([
  '/target:exe',
  '/r:System.Drawing.dll',
  '/r:System.Web.Extensions.dll',
  '/r:Accessibility.dll',
  '/out:' + probe,
  path.resolve('test/fixtures/InstallerProbe.cs'),
]);
const entry = path.join(testRoot, 'Fixture.cs');
await writeFile(entry, 'class Fixture { static void Main() {} }');
compile(['/target:winexe', '/out:' + path.join(stage, name + '.exe'), entry]);
// Use the production Builder/NSIS template with an inert application and a
// unique GUID. Never launch VoxCue or access an actual user's application data.
const artwork = await prepareInstallerUi(path.join(testRoot, 'installer-ui'));
const include = path.join(testRoot, 'isolated-installer.nsh');
await writeFile(
  include,
  `!define VOXCUE_INSTALLER_DATA_DIRECTORY "${data}"
!define VOXCUE_INSTALLER_LEGACY_DATA_DIRECTORY "${legacyData}"
!include "${artwork.include}"
`,
);
const registryKeys = [
  'HKCU\\Software\\' + guid,
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + guid,
];
function registry(operation, key) {
  return spawnSync(
    'reg.exe',
    [operation, key, ...(operation === 'delete' ? ['/f'] : []), '/reg:64'],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      env,
    },
  );
}
for (const key of registryKeys) assert.notEqual(registry('query', key).status, 0);
const active = new Set();
function cleanupOnExit() {
  for (const child of active) {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 15000,
    });
  }
  for (const key of registryKeys) {
    if (registry('query', key).status === 0) registry('delete', key);
  }
}
process.prependListener('SIGINT', cleanupOnExit);
process.prependListener('SIGTERM', cleanupOnExit);
process.prependListener('exit', cleanupOnExit);
function inspect(pid, operation = 'inspect', argument = '') {
  const result = spawnSync(probe, [String(pid), operation, argument], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
async function until(condition, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Timed out: ' + description);
}
async function exited(child) {
  await until(
    () => child.exitCode !== null || child.signalCode !== null,
    'owned NSIS process exit',
  );
  return child.exitCode;
}
async function run(
  executable,
  args = [],
  {
    interactive = false,
    autoStart = false,
    deleteData = false,
    fail = false,
    choosePath = false,
    lockedPath = false,
  } = {},
) {
  assert.ok((await realpath(executable)).startsWith(testRoot + path.sep));
  const child = spawnTestProcess(executable, args, {
    env,
    windowsHide: true,
    stdio: 'ignore',
    // NSIS's special final _?= path consumes raw text, including spaces.
    windowsVerbatimArguments: args.some((argument) => argument.startsWith('_?=')),
  });
  active.add(child);
  child.once('exit', () => active.delete(child));
  let frontend;
  try {
    if (interactive) {
      frontend = await until(() => inspect(child.pid, 'frontend').pid, 'owned installer frontend');
      if (!autoStart) {
        const ready = await until(() => {
          const page = inspect(frontend);
          return (
            page.controls?.some(
              (control) =>
                /^(Install|安装|安裝|Uninstall|卸载|解除安裝)$/.test(control.text) &&
                control.enabled,
            ) && page
          );
        }, 'ready action');
        const browse = ready.controls.find((control) => control.text === 'Browse');
        if (browse) {
          assert.equal(browse.enabled, !lockedPath, 'Existing installs lock the location picker');
          assert.ok(
            ready.controls.some(
              (control) => control.text === (choosePath ? defaultTarget : target),
            ),
            'Selected or existing path is displayed',
          );
        }
        if (choosePath) {
          assert.ok(browse?.enabled);
          inspect(frontend, 'button', browse.text);
          await until(() => inspect(frontend).className === '#32770', 'owned folder picker');
          inspect(frontend, 'folder', chosenParent);
          const folder = inspect(frontend);
          const ok = folder.controls.find((control) => control.id === 1 && control.enabled);
          assert.ok(ok, 'The actual folder picker can confirm the chosen folder');
          inspect(frontend, 'button', ok.text);
          await until(
            () => inspect(frontend).controls?.some((control) => control.text === target),
            'chosen Unicode path displayed',
          );
        }
        const keep = ready.controls.find((control) => control.text === 'Keep my data');
        if (keep) assert.equal(keep.selected, true, 'Uninstall preserves data by default');
        if (deleteData) {
          assert.ok(keep, 'Uninstall must offer a data choice');
          inspect(frontend, 'toggle', keep.text);
          await until(
            () =>
              inspect(frontend).controls.some(
                (control) => control.text === keep.text && !control.selected,
              ),
            'unchecked keep data',
          );
          // Toggling the choice alone must not alter installation or data.
          assert.ok(await readFile(path.join(target, 'version.txt')));
          await preserved();
          inspect(frontend, 'button', 'Uninstall');
        } else {
          const action = ready.controls.find(
            (control) => /^(Install|Uninstall)$/.test(control.text) && control.enabled,
          );
          inspect(frontend, 'button', action.text);
        }
      }
      // A page-only preview cannot detect the hidden multi-user page. Require
      // the actual Builder/NSIS installation to reach its completion signal.
      await until(() => {
        if (child.exitCode !== null || child.signalCode !== null)
          throw Error('NSIS exited before completion: ' + child.exitCode + ' ' + child.signalCode);
        const page = inspect(frontend);
        if (!fail && page.controls?.some((control) => /failed$/.test(control.text)))
          throw Error('Engine failed: ' + page.controls.map((control) => control.text).join(', '));
        return page.controls?.some(
          (control) =>
            (fail ? control.text === 'Uninstall failed' : /^(Finish|完成)$/.test(control.text)) &&
            control.enabled,
        );
      }, 'real Builder/NSIS completion');
      inspect(frontend, 'button', fail ? 'Close' : 'Finish');
    }
    assert.equal(await exited(child), fail ? 2 : 0);
  } finally {
    if (frontend && inspect(child.pid, 'frontend').pid === frontend) {
      try {
        process.kill(frontend);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await until(
        () => child.exitCode !== null || child.signalCode !== null,
        'fixture termination',
      );
    }
  }
}
let uninstallerSequence = 0;
async function uninstaller() {
  let files;
  try {
    files = await readdir(target);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const file = files.find((value) => value === 'Uninstall ' + name + '.exe');
  if (!file) return;
  // Like NSIS's normal self-copy and Builder's old-uninstaller.exe, execute
  // outside the directory being removed; otherwise Windows locks the image.
  const copy = path.join(testRoot, 'uninstaller-' + uninstallerSequence++ + '.exe');
  await copyFile(path.join(target, file), copy);
  return copy;
}
let expectedData = [data, legacyData];
async function seedData(roots = [data, legacyData]) {
  expectedData = roots;
  for (const directory of roots) {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'original.bin'), 'synthetic original document bytes');
  }
}
async function preserved() {
  for (const directory of [data, legacyData]) {
    if (expectedData.includes(directory)) {
      assert.equal(
        await readFile(path.join(directory, 'original.bin'), 'utf8'),
        'synthetic original document bytes',
      );
    } else {
      await assert.rejects(readdir(directory), { code: 'ENOENT' });
    }
  }
}
await seedData();
let latestInstaller;
try {
  for (const version of [previousVersion, currentVersion]) {
    await writeFile(
      path.join(project, 'package.json'),
      JSON.stringify({
        name: name.toLowerCase(),
        version,
        main: 'main.js',
        private: true,
        description: 'Isolated installation fixture',
        author: 'VoxCue',
      }),
    );
    await writeFile(path.join(stage, 'version.txt'), version);
    const artifacts = await build({
      projectDir: project,
      prepackaged: stage,
      publish: 'never',
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
      config: {
        ...config,
        appId: 'com.voxcue.install-test.' + guid,
        productName: name,
        directories: { output: path.join(testRoot, 'artifacts-' + version) },
        electronVersion: '38.8.6',
        compression: 'store',
        publish: null,
        win: {
          ...config.win,
          executableName: name,
          signAndEditExecutable: false,
          icon: path.resolve('public/voxcue.ico'),
        },
        nsis: {
          ...config.nsis,
          guid,
          include,
          createDesktopShortcut: false,
          createStartMenuShortcut: false,
          installerLanguages: ['en_US'],
        },
      },
    });
    const installer = artifacts.find((file) => file.endsWith('.exe'));
    assert.ok(installer, 'Builder must produce an actual installer');
    latestInstaller = installer;
    await run(installer, ['/S', '/allusers', '/D=' + target], { fail: true });
    assert.notEqual(registry('query', registryKeys[0].replace('HKCU', 'HKLM')).status, 0);
    await run(installer, ['/D=' + (version === previousVersion ? defaultTarget : ignoredTarget)], {
      interactive: true,
      choosePath: version === previousVersion,
      lockedPath: version === currentVersion,
    });
    if (version === currentVersion)
      await run(installer, ['--updated', '--force-run', '/D=' + ignoredTarget], {
        interactive: true,
        autoStart: true,
      });
    await assert.rejects(readFile(path.join(ignoredTarget, 'version.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(target, 'version.txt'), 'utf8'), version);
    await preserved();
    assert.equal(
      registry('query', registryKeys[0]).status,
      0,
      'Isolated installation registration',
    );
    await run(installer, ['/S', '--updated', '/D=' + ignoredTarget]);
    assert.equal(await readFile(path.join(target, 'version.txt'), 'utf8'), version);
    await preserved();
  }
  const remove = await uninstaller();
  assert.ok(remove, 'An actual uninstaller must be installed');
  await run(remove, ['/S', '--updated', '--delete-app-data', '_?=' + target], { fail: true });
  await preserved();
  assert.equal(await readFile(path.join(target, 'version.txt'), 'utf8'), currentVersion);
  await run(remove, ['_?=' + target], { interactive: true });
  await preserved();
  for (const key of registryKeys)
    assert.notEqual(registry('query', key).status, 0, 'Uninstall removes its own registration');
  await assert.rejects(readFile(path.join(target, 'version.txt')), { code: 'ENOENT' });
  await run(latestInstaller, ['/S', '/D=' + target]);
  await run(await uninstaller(), ['_?=' + target], { interactive: true, deleteData: true });
  for (const directory of [data, legacyData])
    await assert.rejects(readdir(directory), { code: 'ENOENT' });
  // A new installation normally has no legacy data directory at all.
  await seedData([data]);
  await run(latestInstaller, ['/S', '/D=' + target]);
  await run(await uninstaller(), ['_?=' + target], { interactive: true, deleteData: true });
  for (const directory of [data, legacyData])
    await assert.rejects(readdir(directory), { code: 'ENOENT' });
  await seedData();
  await run(latestInstaller, ['/S', '/D=' + target]);
  await run(await uninstaller(), ['/S', '--updated', '_?=' + target]);
  await preserved();
  await run(latestInstaller, ['/S', '/D=' + target]);
  const outside = path.join(testRoot, 'outside-data');
  await mkdir(outside);
  await writeFile(path.join(outside, 'original.txt'), 'outside data remains');
  const junction = path.join(data, 'redirect');
  await symlink(outside, junction, 'junction');
  try {
    await run(await uninstaller(), ['_?=' + target], {
      interactive: true,
      deleteData: true,
      fail: true,
    });
    await preserved();
    assert.equal(
      await readFile(path.join(outside, 'original.txt'), 'utf8'),
      'outside data remains',
    );
  } finally {
    await unlink(junction);
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      productionNsisTemplate: true,
      manualInstall: true,
      interactiveUpdate: true,
      silentUpdate: true,
      interactiveUninstall: true,
      isolatedGuid: true,
      temporaryFilesOnly: true,
      keepDataDefault: true,
      uncheckedDataDeletion: true,
      rejectRedirectedData: true,
    }),
  );
} finally {
  const remove = await uninstaller();
  if (remove) await run(remove, ['/S', '_?=' + target]);
  for (const key of registryKeys) {
    if (registry('query', key).status === 0) {
      assert.equal(registry('delete', key).status, 0, 'Remove only the test GUID registry key');
    }
    assert.notEqual(registry('query', key).status, 0, 'Test registry cleanup');
  }
}

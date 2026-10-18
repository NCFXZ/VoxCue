import assert from 'node:assert/strict';
import { readdir, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { prepareInstallerUi } from '../../scripts/build-installer-ui.mjs';

assert.equal(process.platform, 'win32');
const preview = process.argv.includes('--preview');
const cache = path.resolve('.cache/electron-builder/nsis-3.0.4.1');
const directory = (await readdir(cache, { withFileTypes: true })).find((entry) =>
  entry.isDirectory(),
);
assert.ok(directory, 'Prepare the pinned NSIS tools with test:installer:isolated first');
const makensis = path.join(cache, directory.name, 'Bin/makensis.exe');
const temporary = path.join(testRoot, 'nsis-tmp');
await mkdir(temporary);
process.env.TEMP = temporary;
process.env.TMP = temporary;
const env = { ...process.env, TEMP: temporary, TMP: temporary };
const artwork = await prepareInstallerUi(path.join(testRoot, 'installer-ui'));
const framework = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319');
const probe = path.join(testRoot, 'InstallerProbe.exe');
const compileProbe = spawnSync(
  path.join(framework, 'csc.exe'),
  [
    '/nologo',
    '/utf8output',
    '/target:exe',
    '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll',
    '/out:' + probe,
    path.resolve('test/fixtures/InstallerProbe.cs'),
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 30000, env },
);
assert.equal(compileProbe.status, 0, compileProbe.stdout + compileProbe.stderr);

function inspect(pid, operation = 'inspect', argument = '') {
  const result = spawnSync(probe, [String(pid), operation, argument], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 4000000,
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
async function until(condition, description) {
  const deadline = Date.now() + 15000;
  let value;
  while (Date.now() < deadline) {
    value = condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw Error('Timed out: ' + description);
}
async function exited(child) {
  if (child.exitCode !== null) return child.exitCode;
  return Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(Error('Fixture did not exit')), 8000);
      timer.unref();
    }),
  ]);
}
function checkPage(page) {
  assert.ok(page.ready);
  for (const label of page.controls.filter((control) => control.text && control.requiredHeight))
    assert.ok(label.requiredHeight <= label.height + 2, 'Clipped native text: ' + label.text);
  assert.ok(page.controls.some((control) => control.text === 'VoxCue'));
}

for (const [language, ready, install, finish, operation = 'install'] of [
  [2052, '准备安装', '安装', '完成'],
  [1033, 'Ready to install', 'Install', 'Finish'],
  [1028, '準備安裝', '安裝', '完成'],
  [2052, '保留个人数据', '卸载', '完成', 'uninstall'],
  [1033, 'Your data will be kept', 'Uninstall', 'Finish', 'uninstall'],
  [1028, '保留個人資料', '解除安裝', '完成', 'uninstall'],
]) {
  const uninstall = operation === 'uninstall';
  if (process.argv.includes('--uninstall-only') && !uninstall) continue;
  const executable = path.join(testRoot, `VoxCue-${operation}-Preview-${language}.exe`);
  const generator = uninstall
    ? path.join(testRoot, `uninstaller-generator-${language}.exe`)
    : executable;
  const source = path.join(testRoot, `preview-${operation}-${language}.nsi`);
  await writeFile(
    source,
    `
Unicode true
Name "VoxCue"
OutFile "${generator}"
RequestExecutionLevel user
!include FileFunc.nsh
Var simulateFailure
!define VERSION "0.2.2"
!define MUI_ICON "${path.resolve('public/voxcue.ico')}"
!define VOXCUE_INSTALLER_PREVIEW
${uninstall ? '!define BUILD_UNINSTALLER' : ''}
!include "${artwork.include}"
!include MUI2.nsh
${
  uninstall
    ? `!insertmacro customUnWelcomePage
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH`
    : `!insertmacro customWelcomePage
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
!insertmacro customFinishPage`
}
!insertmacro MUI_LANGUAGE English
!insertmacro MUI_LANGUAGE SimpChinese
!insertmacro MUI_LANGUAGE TradChinese
Function .onInit
  ${uninstall ? `ClearErrors\n  WriteUninstaller "${executable}"\n  IfErrors 0 +3\n  SetErrorLevel 1\n  Quit\n  SetErrorLevel 0\n  Quit` : `StrCpy $LANGUAGE ${language}\n  \${GetParameters} $0\n  \${GetOptions} $0 "/FAIL" $simulateFailure\n  IfErrors +2\n  StrCpy $simulateFailure "1"`}
FunctionEnd
Section
  ; No installation, files, registry, shortcuts or app launch in this fixture.
  ${uninstall ? '' : 'Sleep 800\n  Sleep 800\n  Sleep 800\n  StrCmp $simulateFailure "1" 0 +2\n  Abort "Synthetic installation failure"'}
SectionEnd
${
  uninstall
    ? `Function un.onInit
  StrCpy $LANGUAGE ${language}
  \${GetParameters} $0
  \${GetOptions} $0 "/FAIL" $simulateFailure
  IfErrors +2
  StrCpy $simulateFailure "1"
FunctionEnd
Section "Uninstall"
  Sleep 800
  Sleep 800
  Sleep 800
  StrCmp $simulateFailure "1" 0 +2
  Abort "Synthetic uninstall failure"
SectionEnd`
    : ''
}
`,
  );
  const compile = spawnSync(makensis, ['/WX', '/V2', '/INPUTCHARSET', 'UTF8', source], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env,
  });
  assert.equal(compile.status, 0, compile.error?.message ?? compile.stdout + compile.stderr);
  if (uninstall) {
    const generated = spawnSync(generator, ['/S'], { windowsHide: true, env, timeout: 15000 });
    assert.equal(generated.status, 0);
    assert.equal((await readFile(executable)).toString('ascii', 0, 2), 'MZ');
  }
  for (const scenario of [
    'complete',
    'cancel',
    'frontend-crash',
    'silent',
    'failure',
    'silent-failure',
  ]) {
    const child = spawnTestProcess(
      executable,
      [
        ...(scenario.startsWith('silent') ? ['/S'] : []),
        ...(scenario.endsWith('failure') ? ['/FAIL'] : []),
        ...(uninstall ? ['_?=' + testRoot] : []),
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
        env,
      },
    );
    let frontend;
    try {
      if (scenario.startsWith('silent')) {
        assert.equal(await exited(child), scenario === 'silent-failure' ? 2 : 0);
        assert.equal(inspect(child.pid, 'frontend').pid, 0);
        continue;
      }
      frontend = await until(() => inspect(child.pid, 'frontend').pid, 'owned frontend');
      const waitButton = (text) =>
        until(() => {
          const page = inspect(frontend);
          return (
            page.ready &&
            page.controls.some((control) => control.text === text && control.enabled) &&
            page
          );
        }, text);
      const first = await waitButton(install);
      checkPage(first);
      const primary = first.controls.find((control) => control.text === install);
      assert.ok(primary.width < first.width / 2);
      const contentLeft = first.controls.find((control) => control.text === ready).x;
      assert.ok(Math.abs(first.width - primary.x - primary.width - contentLeft) <= 2);
      assert.ok(first.controls.some((control) => control.text === ready));
      if (scenario === 'cancel') {
        inspect(frontend, 'key', '27');
        assert.equal(await exited(child), 1);
        continue;
      }
      if (scenario === 'frontend-crash') {
        assert.equal(inspect(child.pid, 'frontend').pid, frontend);
        process.kill(frontend);
        assert.equal(await exited(child), 2);
        continue;
      }
      if (preview && language === 2052)
        console.log(
          JSON.stringify({
            preview: uninstall ? '卸载' : '安装',
            png: inspect(frontend, 'preview').png,
          }),
        );
      inspect(frontend, 'key', '13');
      await until(() => {
        const page = inspect(frontend);
        return (
          page.controls?.some(
            (control) => control.text.endsWith('%') && Number.parseFloat(control.text) > 0,
          ) && page
        );
      }, 'real NSIS progress');
      inspect(frontend, 'close');
      assert.ok(
        inspect(frontend).ready,
        'The active extraction must not be interrupted by closing the frontend',
      );
      if (preview && language === 2052)
        console.log(
          JSON.stringify({
            preview: uninstall ? '卸载进度' : '安装进度',
            png: inspect(frontend, 'preview').png,
          }),
        );
      if (scenario === 'failure') {
        const failed = await until(() => {
          const page = inspect(frontend);
          return page.controls?.some((control) => /failed|失败|失敗/.test(control.text)) && page;
        }, 'visible engine failure');
        checkPage(failed);
        assert.equal(
          failed.controls.some((control) => control.text === finish),
          false,
        );
        inspect(frontend, 'key', '13');
        assert.equal(await exited(child), 2);
        continue;
      }
      const done = await waitButton(finish);
      checkPage(done);
      if (preview && language === 2052)
        console.log(JSON.stringify({ preview: '完成', png: inspect(frontend, 'preview').png }));
      inspect(frontend, 'key', '13');
      assert.equal(await exited(child), 0);
    } finally {
      if (child.exitCode === null) {
        if (frontend && inspect(child.pid, 'frontend').pid === frontend) {
          try {
            process.kill(frontend);
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        }
        child.kill();
        await exited(child);
      }
    }
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      language,
      operation,
      fixture: 'custom-ui-with-no-op-nsis',
      complete: true,
      cancel: true,
      silent: true,
      frontendCrash: true,
      keyboard: true,
      nonzeroEngineProgress: true,
      engineFailure: true,
    }),
  );
}

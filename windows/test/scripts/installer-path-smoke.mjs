import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { prepareInstallerUi } from '../../scripts/build-installer-ui.mjs';
import { probe } from './window-probe.mjs';

assert.equal(process.platform, 'win32');
const compileOnly = process.argv.includes('--compile-only');
assert.ok(process.argv.slice(2).every((value) => value === '--compile-only'));
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const frontend = await prepareInstallerUi(path.join(testRoot, 'frontend'));
const pathProbe = path.join(testRoot, 'InstallerPathFixture.exe');
const compile = spawnSync(
  compiler,
  [
    '/nologo',
    '/utf8output',
    '/target:exe',
    '/main:InstallerPathFixture',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    '/out:' + pathProbe,
    path.resolve('native/InstallerWindow.cs'),
    path.resolve('test/fixtures/InstallerPathFixture.cs'),
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
);
assert.equal(compile.status, 0, compile.error?.message ?? compile.stdout + compile.stderr);
assert.ok((await readFile(frontend.exe)).subarray(0, 2).equals(Buffer.from('MZ')));

const nsisRoot = path.resolve('.cache/electron-builder/nsis-3.0.4.1');
const nsis = (await readdir(nsisRoot, { withFileTypes: true })).find((entry) =>
  entry.isDirectory(),
);
assert.ok(nsis, 'Prepare the existing pinned NSIS compiler first');
const makensis = path.join(nsisRoot, nsis.name, 'Bin/makensis.exe');
const guid = randomUUID();
const key = `Software\\VoxCue-InstallerPathFixture-${guid}`;
const installer = path.join(testRoot, 'PathFixture.exe');
const source = path.join(testRoot, 'path-fixture.nsi');
const nsisMacro = (name) => '${' + name + '}';
await writeFile(
  source,
  `
Unicode true
Name "VoxCue path guard fixture"
OutFile "${installer}"
InstallDir "${path.join(testRoot, 'default')}"
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!include FileFunc.nsh
!define APP_EXECUTABLE_FILENAME "Fixture.exe"
!define UNINSTALL_FILENAME "Uninstall Fixture.exe"
!define INSTALL_REGISTRY_KEY "${key}\\Install"
!define UNINSTALL_REGISTRY_KEY "${key}\\Uninstall"
!define UNINSTALL_REGISTRY_KEY_2 "${key}\\LegacyUninstall"
!include "${path.resolve('scripts/installer-path.nsh')}"
!insertmacro VoxCueInstallDirectoryFunctions
Function .onInit
  SetRegView 64
  ; NSIS strips /D from $CMDLINE; read the original command line, as Builder's
  ; StdUtils.GetAllParameters-based scope helper does.
  System::Call 'kernel32::GetCommandLineW()w.r0'
  ; Match Builder's explicit /D restoration rather than NSIS startup's
  ; automatic install-directory sanitization of an invalid file target.
  ClearErrors
  ${nsisMacro('GetOptions')} $0 "/D=" $1
  ${nsisMacro('IfNot')} ${nsisMacro('Errors')}
    StrCpy $INSTDIR $1
  ${nsisMacro('EndIf')}
  ClearErrors
  ${nsisMacro('GetOptions')} $0 "/UPGRADE=" $VoxCueRegisteredDirectory
  ${nsisMacro('IfNot')} ${nsisMacro('Errors')}
    WriteRegStr HKCU "${key}\\Install" InstallLocation "$VoxCueRegisteredDirectory"
    WriteRegStr HKCU "${key}\\Uninstall" UninstallString '$\\"$VoxCueRegisteredDirectory\\Uninstall Fixture.exe$\\" /currentuser'
  ${nsisMacro('EndIf')}
  ClearErrors
  ${nsisMacro('GetOptions')} $0 "/LEGACY" $1
  ${nsisMacro('IfNot')} ${nsisMacro('Errors')}
    WriteRegStr HKCU "${key}\\LegacyUninstall" UninstallString '$\\"$VoxCueRegisteredDirectory\\Uninstall Fixture.exe$\\" /currentuser'
  ${nsisMacro('EndIf')}
  ClearErrors
  ${nsisMacro('GetOptions')} $0 "/BADLEGACY" $1
  ${nsisMacro('IfNot')} ${nsisMacro('Errors')}
    WriteRegStr HKCU "${key}\\LegacyUninstall" UninstallString "unrelated command must not run"
  ${nsisMacro('EndIf')}
  ClearErrors
  ${nsisMacro('GetOptions')} $0 "/STALE" $1
  ${nsisMacro('IfNot')} ${nsisMacro('Errors')}
    WriteRegStr HKCU "${key}\\Uninstall" UninstallString "synthetic missing install location"
  ${nsisMacro('EndIf')}
  Call VoxCueRequireInstallDirectory
  ClearErrors
  ${nsisMacro('GetOptions')} $0 "/RACE" $1
  ${nsisMacro('IfNot')} ${nsisMacro('Errors')}
    CreateDirectory "$INSTDIR"
    FileOpen $1 "$INSTDIR\\late-file.txt" w
    FileWrite $1 "preserve late file"
    FileClose $1
  ${nsisMacro('EndIf')}
FunctionEnd
Section
  Call VoxCueRequireInstallDirectory
  Call VoxCuePrepareMissingInstallation
  ${nsisMacro('If')} $VoxCueRepairMissingDirectory == "true"
    ReadRegStr $0 HKCU "${key}\\Uninstall" UninstallString
    ReadRegStr $1 HKCU "${key}\\LegacyUninstall" UninstallString
    ${nsisMacro('If')} $0 != ""
    ${nsisMacro('OrIf')} $1 != ""
      SetErrorLevel 9
      Quit
    ${nsisMacro('EndIf')}
  ${nsisMacro('EndIf')}
  SetErrorLevel 0
SectionEnd
`,
);
const nsisCompile = spawnSync(makensis, ['/WX', '/V2', '/INPUTCHARSET', 'UTF8', source], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30_000,
});
assert.equal(
  nsisCompile.status,
  0,
  nsisCompile.error?.message ?? nsisCompile.stdout + nsisCompile.stderr,
);
if (compileOnly) {
  console.log(
    'PASS installer frontend, pure path guard and independent NSIS guard compile; no installer or native probe executed.',
  );
  process.exit(0);
}
assert.equal(
  probe('desktop').interactive,
  true,
  'Native installer guards require the unlocked owner console',
);

const registryKey = 'HKCU\\' + key;
const registry = (operation) =>
  spawnSync(
    'reg.exe',
    [operation, registryKey, ...(operation === 'delete' ? ['/f'] : []), '/reg:64'],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    },
  );
assert.notEqual(registry('query').status, 0, 'A fixture registry key must never preexist');
const cleanRegistry = () => {
  if (registry('query').status === 0) assert.equal(registry('delete').status, 0);
};
process.once('exit', cleanRegistry);
const run = (executable, args, expected) => {
  assert.equal(probe('desktop').interactive, true);
  if (executable === installer) cleanRegistry();
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(
    result.status,
    expected,
    JSON.stringify({
      executable: path.basename(executable),
      args,
      error: result.error?.message,
      output: result.stdout + result.stderr,
    }),
  );
};
try {
  const empty = path.join(testRoot, 'empty');
  const dirty = path.join(testRoot, 'VoxCue');
  const hidden = path.join(testRoot, 'hidden');
  const upgraded = path.join(testRoot, 'registered');
  const race = path.join(testRoot, 'race');
  for (const directory of [empty, dirty, hidden, upgraded, race]) await mkdir(directory);
  await writeFile(path.join(dirty, 'personal-document.txt'), 'preserve');
  await writeFile(path.join(hidden, '.private'), 'preserve hidden');
  run(
    path.join(process.env.WINDIR, 'System32/attrib.exe'),
    ['+H', path.join(hidden, '.private')],
    0,
  );
  await writeFile(path.join(upgraded, 'Fixture.exe'), 'inert application');
  await writeFile(path.join(upgraded, 'Uninstall Fixture.exe'), 'inert uninstaller');
  const file = path.join(testRoot, 'ordinary-file');
  await writeFile(file, 'preserve');
  const linked = path.join(testRoot, 'linked');
  await symlink(dirty, linked, 'junction');
  const absent = path.join(testRoot, 'new', 'VoxCue');
  const cases = [
    [absent, 0, 0],
    [empty, 0, 0],
    [dirty, 3, 2],
    [hidden, 3, 2],
    [file, 1, 2],
    [path.parse(testRoot).root, 1, 2],
    [linked, 2, 2],
    [path.join(linked, 'new'), 2, 2],
  ];
  for (const [candidate, nativeCode, nsisCode] of cases) {
    run(pathProbe, [candidate], nativeCode);
    run(installer, ['/S', '/D=' + candidate], nsisCode);
  }
  run(pathProbe, [upgraded, 'upgrade'], 0);
  run(installer, ['/S', '/UPGRADE=' + upgraded, '/D=' + upgraded], 0);
  run(installer, ['/S', '/UPGRADE=' + dirty, '/D=' + dirty], 2);
  run(installer, ['/S', '/UPGRADE=' + absent, '/D=' + absent], 0);
  run(installer, ['/S', '/UPGRADE=' + absent, '/LEGACY', '/D=' + absent], 0);
  run(installer, ['/S', '/UPGRADE=' + absent, '/BADLEGACY', '/D=' + absent], 2);
  run(installer, ['/S', '/UPGRADE=' + empty, '/D=' + empty], 2);
  const repairRace = path.join(testRoot, 'repair-race', 'VoxCue');
  run(installer, ['/S', '/UPGRADE=' + repairRace, '/RACE', '/D=' + repairRace], 2);
  assert.equal(await readFile(path.join(repairRace, 'late-file.txt'), 'utf8'), 'preserve late file');
  run(installer, ['/S', '/UPGRADE=' + upgraded, '/D=' + empty], 2);
  run(installer, ['/S', '/STALE', '/D=' + empty], 2);
  run(installer, ['/S', '/RACE', '/D=' + race], 2);
  assert.equal(await readFile(path.join(race, 'late-file.txt'), 'utf8'), 'preserve late file');
  assert.equal(await readFile(path.join(dirty, 'personal-document.txt'), 'utf8'), 'preserve');
  assert.equal(await readFile(path.join(hidden, '.private'), 'utf8'), 'preserve hidden');
  assert.equal(await readFile(file, 'utf8'), 'preserve');
  console.log(
    'PASS empty/new destinations, existing files, hidden files, drive root, reparse target/ancestor, registered upgrade, missing-directory repair without stale uninstall commands, forged registration and repeated pre-install validation; fixture contents preserved.',
  );
} finally {
  cleanRegistry();
  process.removeListener('exit', cleanRegistry);
}

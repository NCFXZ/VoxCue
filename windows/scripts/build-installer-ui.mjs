import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function prepareInstallerUi(output = path.join(root, '.cache/installer-ui')) {
  assert.equal(process.platform, 'win32');
  await mkdir(output, { recursive: true });
  const exe = path.join(output, 'VoxCue.Setup.UI.exe');
  const manifest = path.join(output, 'frontend.manifest');
  await writeFile(
    manifest,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="*" name="VoxCue.Setup.UI" type="win32"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings><dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware></windowsSettings></application>
</assembly>`,
  );
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result = spawnSync(
    compiler,
    [
      '/nologo',
      '/utf8output',
      '/optimize+',
      '/target:winexe',
      '/r:System.Drawing.dll',
      '/r:System.Windows.Forms.dll',
      '/win32icon:' + path.join(root, 'public/voxcue.ico'),
      '/win32manifest:' + manifest,
      '/out:' + exe,
      path.join(root, 'native/InstallerWindow.cs'),
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
  const logo = path.join(output, 'brand.png');
  const include = path.join(output, 'installer.nsh');
  await copyFile(path.join(root, '../shared/public/voxcue.png'), logo);
  await writeFile(
    include,
    `!define VOXCUE_INSTALLER_FRONTEND "${exe}"\n!define VOXCUE_INSTALLER_LOGO "${logo}"\n!define VOXCUE_INSTALLER_UNINSTALL_PAGE "${path.join(root, 'scripts/installer-uninstall-page.nsh')}"\n!include "${path.join(root, 'scripts/installer.nsh')}"\n`,
  );
  return { include, exe, logo };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareInstallerUi();
  console.log('Generated custom Windows installer interface.');
}

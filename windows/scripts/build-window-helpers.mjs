import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') throw Error('Window helpers require Windows');
const native = path.resolve(import.meta.dirname, '../native');
mkdirSync(path.join(native, 'bin'), { recursive: true });
for (const name of ['Screenshot', 'WindowMotion', 'ApiKeyPrompt']) {
  const source = path.join(native, name + '.cs');
  const output = path.join(native, 'bin', 'VoxCue.' + name + '.exe');
  const manifest = name === 'ApiKeyPrompt' ? path.join(native, 'ApiKeyPrompt.manifest') : undefined;
  const updated = Math.max(statSync(source).mtimeMs, manifest ? statSync(manifest).mtimeMs : 0);
  if (existsSync(output) && statSync(output).size && statSync(output).mtimeMs >= updated) continue;
  const result = spawnSync(
    path.join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/optimize+',
      '/platform:x64',
      '/target:exe',
      ...(name === 'Screenshot' ? ['/r:System.Drawing.dll'] : []),
      ...(manifest ? ['/win32manifest:' + manifest, '/codepage:65001', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll'] : []),
      '/out:' + output,
      source,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(name + ' helper compilation failed');
}

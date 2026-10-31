import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') throw Error('Windows screenshot helper requires Windows');
const source = path.resolve(import.meta.dirname, '../native/Screenshot.cs');
const output = path.resolve(import.meta.dirname, '../native/bin/VoxCue.Screenshot.exe');
mkdirSync(path.dirname(output), { recursive: true });
if (
  !existsSync(output) ||
  !statSync(output).size ||
  statSync(output).mtimeMs < statSync(source).mtimeMs
) {
  const result = spawnSync(
    path.join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/optimize+',
      '/platform:x64',
      '/target:exe',
      '/r:System.Drawing.dll',
      '/out:' + output,
      source,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Windows screenshot helper compilation failed');
}

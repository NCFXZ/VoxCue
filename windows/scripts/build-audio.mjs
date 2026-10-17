import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
if (process.platform !== 'win32') throw Error('Windows WASAPI helper requires Windows');
mkdirSync('native/bin', { recursive: true });
const source = path.resolve('native/WasapiCapture.cs');
const output = path.resolve('native/bin/VoxCue.Audio.exe');
// Reuse an unchanged helper while the user is using it in an interview. A
// changed source still requires a successful compile; never replace a live exe.
if (
  existsSync(output) &&
  statSync(output).size > 0 &&
  statSync(output).mtimeMs >= statSync(source).mtimeMs
) {
  console.log('Windows audio helper is up to date.');
  process.exit(0);
}
const compiler = path.join(
  process.env.WINDIR ?? 'C:/Windows',
  'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
);
const result = spawnSync(
  compiler,
  [
    '/nologo',
    '/optimize+',
    '/platform:x64',
    '/target:exe',
    '/r:System.Web.Extensions.dll',
    '/out:' + output,
    source,
  ],
  { stdio: 'inherit', windowsHide: true },
);
process.exitCode = result.status ?? 1;

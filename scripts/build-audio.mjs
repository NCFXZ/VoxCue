import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
if (process.platform !== 'win32') throw Error('Windows WASAPI helper requires Windows');
mkdirSync('native/bin', { recursive: true });
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
    '/out:' + path.resolve('native/bin/VoxCue.Audio.exe'),
    path.resolve('native/WasapiCapture.cs'),
  ],
  { stdio: 'inherit', windowsHide: true },
);
process.exitCode = result.status ?? 1;

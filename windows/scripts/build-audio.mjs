import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
if (process.platform !== 'win32') throw Error('Windows WASAPI helper requires Windows');
mkdirSync('native/bin', { recursive: true });
const cpuSource = path.resolve('native/CpuFeatures.rs');
const cpuContract = path.resolve('../shared/native/qwen-speech/vendor/qwen-aligner/src/cpu_features.rs');
const cpuOutput = path.resolve('native/bin/VoxCue.Cpu.exe');
if (
  !existsSync(cpuOutput) ||
  statSync(cpuOutput).size === 0 ||
  [cpuSource, cpuContract, new URL(import.meta.url)]
    .some((file) => statSync(file).mtimeMs > statSync(cpuOutput).mtimeMs)
) {
  // Fixed, authenticated build-time tooling only. The small standalone helper
  // has no model/runtime dependency and can preflight older Qwen components.
  const toolchain = path.resolve('.tools/rust-1.90.0-gnu');
  const rustc = path.join(toolchain, 'bin/rustc.exe');
  const linker = path.join(toolchain, 'lib/rustlib/x86_64-pc-windows-gnu/bin/self-contained/x86_64-w64-mingw32-gcc.exe');
  if (!existsSync(rustc) || !existsSync(linker))
    throw Error('Restore the official SHA-256 verified Rust 1.90.0 GNU toolchain in windows/.tools/rust-1.90.0-gnu before building native helpers.');
  const result = spawnSync(rustc, [
    '--edition=2021', '-O', '-C', 'strip=symbols', '-C', 'target-cpu=x86-64',
    '-C', 'target-feature=+crt-static', '-C', 'link-self-contained=yes',
    '-C', `linker=${linker}`, '-o', cpuOutput, cpuSource,
  ], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
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

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
if (process.platform !== 'win32') throw Error('Windows WASAPI helper requires Windows');
mkdirSync('native/bin', { recursive: true });
const cpuSource = path.resolve('native/CpuFeatures.rs');
const cpuContract = path.resolve('../shared/native/qwen-speech/vendor/qwen-aligner/src/cpu_features.rs');
const cpuOutput = path.resolve('native/bin/VoxCue.Cpu.exe');
const wasapiOnly = process.argv.includes('--wasapi-only');
const missingOnly = process.argv.includes('--missing-only');
function needsBuild(output, sources) {
  const built = statSync(output, { throwIfNoEntry: false });
  return !built?.size || (!missingOnly && sources.some(file => statSync(file).mtimeMs > built.mtimeMs));
}
function compile(output, compiler, argumentsFor) {
  const directory = mkdtempSync(path.join(path.dirname(output), '.build-'));
  const temporary = path.join(directory, path.basename(output));
  try {
    const result = spawnSync(compiler, argumentsFor(temporary), { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(`Failed to build ${path.basename(output)}`);
    if (!missingOnly || needsBuild(output, [])) renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
    rmdirSync(directory);
  }
}
if (!wasapiOnly && needsBuild(cpuOutput, [cpuSource, cpuContract, new URL(import.meta.url)])) {
  // Fixed, authenticated build-time tooling only. The small standalone helper
  // has no model/runtime dependency and can preflight older Qwen components.
  const toolchain = path.resolve('.tools/rust-1.90.0-gnu');
  const rustc = path.join(toolchain, 'bin/rustc.exe');
  const linker = path.join(toolchain, 'lib/rustlib/x86_64-pc-windows-gnu/bin/self-contained/x86_64-w64-mingw32-gcc.exe');
  if (!existsSync(rustc) || !existsSync(linker)) {
    await import('./restore-rust-toolchain.mjs');
  }
  compile(cpuOutput, rustc, temporary => [
    '--edition=2021', '-O', '-C', 'strip=symbols', '-C', 'target-cpu=x86-64',
    '-C', 'target-feature=+crt-static', '-C', 'link-self-contained=yes',
    '-C', `linker=${linker}`, '-o', temporary, cpuSource,
  ]);
}
const source = path.resolve('native/WasapiCapture.cs');
const output = path.resolve('native/bin/VoxCue.Audio.exe');
// Reuse an unchanged helper while the user is using it in an interview. A
// changed source still requires a successful compile; never replace a live exe.
if (!needsBuild(output, [source])) {
  process.exit(0);
}
const compiler = path.join(
  process.env.WINDIR ?? 'C:/Windows',
  'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
);
compile(output, compiler, temporary => [
  '/nologo',
  '/optimize+',
  '/platform:x64',
  '/target:exe',
  '/r:System.Web.Extensions.dll',
  '/out:' + temporary,
  source,
]);

import { packager } from '@electron/packager';
import { createRequire } from 'node:module';
import { readFile, cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync, realpathSync as fsRealPath, lstatSync, readFileSync } from 'node:fs';
import os from 'node:os';
import fuses from '@electron/fuses';
import { prepareVcRuntime } from './vc-runtime.mjs';
const { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options } = fuses;
const root = process.cwd();
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
const overrides =
  yaml.load(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).overrides ?? {};
const includedDependency = (owner, dependency) => overrides[`${owner}>${dependency}`] !== '-';
const installer = process.argv.includes('--installer');
const store = process.argv.includes('--store');
if (installer && store) throw Error('Choose one Windows packaging channel');
const testOutput = process.argv
  .find((argument) => argument.startsWith('--test-output='))
  ?.slice('--test-output='.length);
const outputName = store
  ? 'release/store-stage'
  : installer
    ? 'release/installer-stage'
    : 'release-smoke';
const output = path.resolve(testOutput ?? outputName);
if (testOutput) {
  const parent = path.dirname(output);
  if (
    installer ||
    path.dirname(parent) !== fsRealPath(os.tmpdir()) ||
    !path.basename(parent).startsWith('voxcue-test-run-') ||
    !path.basename(output).startsWith('platform-layout-') ||
    lstatSync(parent).isSymbolicLink() ||
    fsRealPath(parent) !== parent
  )
    throw Error('Unsafe verification output');
  const owner = JSON.parse(readFileSync(path.join(parent, '.voxcue-test-owner.json'), 'utf8'));
  if (owner.kind !== 'voxcue-test-run-' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw Error('Unknown verification owner');
  process.kill(owner.pid, 0);
}
// Packager may replace only this generated output, never a user profile or arbitrary path.
if (!testOutput && output !== path.join(root, outputName)) throw Error('Unsafe portable output');
if (!testOutput && (installer || store) && existsSync(path.dirname(output))) {
  const parent = fsRealPath(path.dirname(output));
  if (path.relative(root, parent).startsWith('..') || path.isAbsolute(path.relative(root, parent)))
    throw Error('Release staging parent escapes workspace');
}
if (existsSync(output)) {
  const real = fsRealPath(output);
  const allowedRoot = testOutput ? path.dirname(output) : root;
  if (
    (store && path.relative(output, real) !== '') ||
    path.relative(allowedRoot, real).startsWith('..') ||
    path.isAbsolute(path.relative(allowedRoot, real))
  )
    throw Error('Portable output escapes workspace');
}
const storeStage = path.join(output, 'VoxCue-win32-x64');
if (store && existsSync(storeStage) && path.relative(storeStage, fsRealPath(storeStage)) !== '')
  throw Error('Unexpected Store staging path');
const electronVersion = require('electron/package.json').version;
const electronZipDir = path.resolve('.cache/electron');
const { createMobileAssets } = require(
  path.join(root, 'dist-electron/shared/electron/backend/remoteConnection/assets.js'),
);
if (!(await createMobileAssets(path.join(root, 'dist')).read('/')))
  throw Error('Bundled mobile page is missing; run the shared build first.');
const paths = await packager({
  icon: path.resolve('public/voxcue.ico'),
  dir: root,
  out: output,
  ...(testOutput ? { tmpdir: path.dirname(output) } : {}),
  name: 'VoxCue',
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  electronZipDir: existsSync(
    path.join(electronZipDir, `electron-v${electronVersion}-win32-x64.zip`),
  )
    ? electronZipDir
    : undefined,
  overwrite: true,
  prune: false,
  asar: {
    unpackDir:
      '{node_modules,dist-electron/shared/electron/backend/speech,dist-electron/shared/electron/backend/knowledge,dist-electron/shared/electron/backend/screenshot,dist-electron/shared/electron/contracts,dist-electron/windows/electron/speech}',
  },
  ignore: [
    /^\/node_modules(?:\/|$)/,
    /^\/(?:\.git|\.pnpm-store|test|release|release-smoke|local-models|src|electron|docs|tests|scripts|\.codex|\.agents)(?:\/|$)/,
    /^\/(?!dist(?:\/|$)|dist-electron(?:\/|$)|public(?:\/|$)|package\.json$)/,
  ],
  afterCopy: [
    async ({ buildPath }) => {
      const publicKey = JSON.parse(
        await readFile(path.join(root, 'update-public-key.json'), 'utf8'),
      );
      const { windowsUpdateKey } = require(
        path.join(root, 'dist-electron/shared/electron/backend/updates/windowsManifest.js'),
      );
      if (publicKey.protocol !== 1) throw Error('Invalid Windows update key protocol');
      windowsUpdateKey(publicKey.publicKey);
      // Pin the canonical key inside the archive before its integrity hash is embedded.
      await writeFile(
        path.join(buildPath, 'dist-electron/windows/electron/voxcue-update.json'),
        JSON.stringify({ ...publicKey, repository: 'NCFXZ/VoxCue-releases' }) + '\n',
      );
      if (!(await createMobileAssets(path.join(buildPath, 'dist')).read('/')))
        throw Error('The packaged application is missing its mobile page assets.');
      await cp(path.resolve('../shared/public'), path.join(buildPath, 'public'), {
        recursive: true,
      });
      const copied = new Set();
      async function copyPackage(name, from = root) {
        // E5 uses Node CPU inference; the CJS bundle needs no separate Web package.
        if (name === 'onnxruntime-web' || name === 'koffi') return;
        // Copilot uses only the official stdio subprocess, never the optional FFI host.
        let resolved;
        const require = createRequire(path.join(from, 'package.json'));
        try {
          resolved = require.resolve(name + '/package.json');
        } catch {
          for (const nodePath of require.resolve.paths(name) ?? []) {
            try {
              const file = path.join(nodePath, name, 'package.json');
              const json = JSON.parse(await readFile(file, 'utf8'));
              if (json.name === name) {
                resolved = file;
                break;
              }
            } catch {}
          }
        }
        if (!resolved) throw Error('Missing dependency ' + name);
        const source = path.dirname(resolved),
          pkg = JSON.parse(await readFile(resolved, 'utf8'));

        const matches = (list, value) =>
          !list ||
          (!list.includes('!' + value) &&
            (!list.some((item) => !item.startsWith('!')) || list.includes(value)));
        if (!matches(pkg.os, 'win32') || !matches(pkg.cpu, 'x64')) return;
        // Mirror the configured hoisted layout, including nested version conflicts.
        // A package is copied once; flattening different ONNX versions would be incorrect.
        const relative = path.relative(path.join(root, 'node_modules'), source);
        if (relative.startsWith('..') || path.isAbsolute(relative))
          throw Error('Dependency escapes local hoisted node_modules: ' + name);
        const destination = path.join(buildPath, 'node_modules', relative);
        if (copied.has(destination)) return;
        copied.add(destination);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(source, destination, {
          recursive: true,
          filter: (p) => {
            const relative = path.relative(source, p).replaceAll('\\', '/');
            return (
              !relative.startsWith('node_modules') &&
              // APPX reserves the Open Packaging Convention paths in these Word fixtures.
              !(store && name === 'mammoth' && /^test(?:\/|$)/.test(relative)) &&
              !/^bin\/napi-v6\/(?:darwin|linux)/.test(relative) &&
              !/^bin\/napi-v6\/win32\/(?:arm64|ia32)/.test(relative)
            );
          },
        });
        for (const dependency of Object.keys(pkg.dependencies ?? {}))
          if (includedDependency(pkg.name, dependency)) await copyPackage(dependency, source);
        // LanceDB requires apache-arrow as a runtime peer rather than an owned dependency.
        for (const dependency of Object.keys(pkg.peerDependencies ?? {})) {
          try {
            await copyPackage(dependency, source);
          } catch (error) {
            if (!pkg.peerDependenciesMeta?.[dependency]?.optional) throw error;
          }
        }
        for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) {
          if (!includedDependency(pkg.name, dependency)) continue;
          if (
            /sherpa-onnx-(?:darwin|linux|win-ia32)|(?:lancedb|sharp|canvas|onnxruntime)-(?:darwin|linux|android)|win32-(?:arm64|ia32)/.test(
              dependency,
            )
          )
            continue;
          try {
            await copyPackage(dependency, source);
          } catch (e) {
            if (
              !String(e).includes('Cannot find module') &&
              !String(e).includes('Missing dependency')
            )
              throw e;
          }
        }
      }
      for (const name of [
        '@github/copilot-sdk',
        '@github/copilot-sdk-win32-x64',
        '@openai/codex',
        '@openai/codex-win32-x64',
        '@ennuicastr/webrtcaec3.js',
        'adm-zip',
        'jose',
        'ws',
        'electron-updater',
        'sherpa-onnx-node',
        'sharp',
        'sherpa-onnx-win-x64',
        '@lancedb/lancedb',
        '@huggingface/transformers',
        // The Transformers CJS bundle imports this directly, outside its declared dependencies.
        'onnxruntime-common',
        'pdf-parse',
        'mammoth',
        'word-extractor',
        'chardet',
      ])
        await copyPackage(name);
      // Node loads addons with an altered DLL search path. Keep the fixed CRT
      // beside the actual LanceDB/ONNX binaries, before ASAR and unpacking.
      const runtime = await prepareVcRuntime();
      for (const directory of copied) {
        const targets = [];
        if (directory.endsWith(path.join('node_modules', '@lancedb', 'lancedb-win32-x64-msvc'))) {
          if (!existsSync(path.join(directory, 'lancedb.win32-x64-msvc.node')))
            throw Error('Packaged LanceDB native binding is missing');
          targets.push(directory);
        } else if (path.basename(directory) === 'onnxruntime-node') {
          for (const abi of await readdir(path.join(directory, 'bin'), { withFileTypes: true })) {
            if (!abi.isDirectory() || !/^napi-v\d+$/.test(abi.name)) continue;
            const target = path.join(directory, 'bin', abi.name, 'win32', 'x64');
            if (!existsSync(path.join(target, 'onnxruntime_binding.node')))
              throw Error('Packaged ONNX native binding is missing');
            targets.push(target);
          }
        }
        for (const target of targets)
          for (const file of runtime.files)
            await cp(path.join(runtime.directory, file.name), path.join(target, file.name));
      }
    },
  ],
  afterComplete: [
    async ({ buildPath }) => {
      const executable = path.join(buildPath, 'VoxCue.exe');
      const policy = {
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
      };
      await flipFuses(executable, { version: FuseVersion.V1, ...policy });
      const actualFuses = await getCurrentFuseWire(executable);
      for (const [key, enabled] of Object.entries(policy))
        if (actualFuses[key] !== (enabled ? '1' : '0').charCodeAt(0))
          throw Error('Packaged Windows security fuse verification failed');
      await writeFile(
        path.join(buildPath, 'resources/voxcue-components.json'),
        JSON.stringify({ schemaVersion: 1 }) + '\n',
      );
      const runtime = await prepareVcRuntime();
      const licenses = path.join(buildPath, 'resources/licenses');
      await mkdir(licenses, { recursive: true });
      await cp(
        path.join(runtime.directory, runtime.license.name),
        path.join(licenses, runtime.license.name),
      );
      await mkdir(path.join(buildPath, 'resources/native'), { recursive: true });
      await cp(
        path.resolve('native/bin/VoxCue.Audio.exe'),
        path.join(buildPath, 'resources/native/VoxCue.Audio.exe'),
      );
      await cp(
        path.resolve('native/bin/VoxCue.Screenshot.exe'),
        path.join(buildPath, 'resources/native/VoxCue.Screenshot.exe'),
      );
      await cp(
        path.resolve('native/bin/VoxCue.Cpu.exe'),
        path.join(buildPath, 'resources/native/VoxCue.Cpu.exe'),
      );
    },
  ],
});
console.log(JSON.stringify({ paths }));

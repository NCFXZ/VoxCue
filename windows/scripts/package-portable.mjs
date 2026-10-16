import { packager } from '@electron/packager';
import { createRequire } from 'node:module';
import { readFile, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { existsSync, realpathSync as fsRealPath } from 'node:fs';
const root = process.cwd();
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
const overrides =
  yaml.load(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).overrides ?? {};
const includedDependency = (owner, dependency) => overrides[`${owner}>${dependency}`] !== '-';
const installer = process.argv.includes('--installer');
const testOutput = process.argv
  .find((argument) => argument.startsWith('--test-output='))
  ?.slice('--test-output='.length);
const output = path.resolve(
  testOutput ?? (installer ? 'release/installer-stage' : 'release-smoke'),
);
if (
  testOutput &&
  (installer ||
    path.dirname(output) !== path.join(root, 'test/results') ||
    !path.basename(output).startsWith('platform-layout-'))
)
  throw Error('Unsafe verification output');
// Packager may replace only this generated output, never a user profile or arbitrary path.
if (
  !testOutput &&
  output !== path.join(root, installer ? 'release/installer-stage' : 'release-smoke')
)
  throw Error('Unsafe portable output');
if ((installer || testOutput) && existsSync(path.dirname(output))) {
  const parent = fsRealPath(path.dirname(output));
  if (path.relative(root, parent).startsWith('..') || path.isAbsolute(path.relative(root, parent)))
    throw Error('Installer parent escapes workspace');
}
if (existsSync(output)) {
  const real = fsRealPath(output);
  if (path.relative(root, real).startsWith('..') || path.isAbsolute(path.relative(root, real)))
    throw Error('Portable output escapes workspace');
}
const paths = await packager({
  icon: path.resolve('public/voxcue.ico'),
  dir: root,
  out: output,
  name: 'VoxCue',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.8.6',
  electronZipDir: existsSync(path.resolve('test/results/electron-zip'))
    ? path.resolve('test/results/electron-zip')
    : undefined,
  overwrite: true,
  prune: false,
  asar: {
    unpackDir:
      '{node_modules,dist-electron/shared/electron/backend/speech,dist-electron/shared/electron/backend/knowledge,dist-electron/shared/electron/contracts,dist-electron/windows/electron/speech}',
  },
  ignore: [
    /^\/node_modules(?:\/|$)/,
    /^\/(?:\.git|\.pnpm-store|test|release|release-smoke|local-models|src|electron|docs|tests|scripts|\.codex|\.agents)(?:\/|$)/,
    /^\/(?!dist(?:\/|$)|dist-electron(?:\/|$)|public(?:\/|$)|package\.json$)/,
  ],
  afterCopy: [
    async ({ buildPath }) => {
      const copied = new Set();
      async function copyPackage(name, from = root) {
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
        'jose',
        '@github/copilot-sdk',
        // Required for the Windows artifact even though npm declares it optional.
        '@github/copilot-sdk-win32-x64',
        'electron-updater',
        'sherpa-onnx-node',
        'sherpa-onnx-win-x64',
        '@lancedb/lancedb',
        '@huggingface/transformers',
        // The Transformers CJS bundle imports this directly, outside its declared dependencies.
        'onnxruntime-common',
        'pdf-parse',
        'mammoth',
      ])
        await copyPackage(name);
    },
  ],
  afterComplete: [
    async ({ buildPath }) => {
      await cp(
        path.resolve('local-models/speech'),
        path.join(buildPath, 'resources/models/speech'),
        {
          recursive: true,
          filter: (source) => {
            const relative = path.relative(path.resolve('local-models/speech'), source);
            return (
              relative === '' ||
              [
                'encoder.int8.onnx',
                'decoder.int8.onnx',
                'tokens.txt',
                'silero_vad.onnx',
                'manifest.json',
                'README.md',
                'LICENSE-sherpa.txt',
                'LICENSE-silero.txt',
              ].includes(relative)
            );
          },
        },
      );
      if (
        !existsSync(
          path.resolve('local-models/rag/multilingual-e5-small/onnx/model_quantized.onnx'),
        )
      )
        throw Error('Run pnpm download:rag before packaging');
      await cp(
        path.resolve('local-models/rag/multilingual-e5-small'),
        path.join(buildPath, 'resources/models/rag/multilingual-e5-small'),
        { recursive: true },
      );
      await mkdir(path.join(buildPath, 'resources/native'), { recursive: true });
      await cp(
        path.resolve('native/bin/VoxCue.Audio.exe'),
        path.join(buildPath, 'resources/native/VoxCue.Audio.exe'),
      );
    },
  ],
});
console.log(JSON.stringify({ paths }));

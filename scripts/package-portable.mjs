import { packager } from '@electron/packager';
import { createRequire } from 'node:module';
import { readFile, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
const root = process.cwd();
const output = path.resolve('release-smoke');
const paths = await packager({
  icon: path.resolve('public/voxcue.ico'),
  dir: root,
  out: output,
  name: 'VoxCue',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.8.6',
  electronZipDir: existsSync(path.resolve('test-results/electron-zip'))
    ? path.resolve('test-results/electron-zip')
    : undefined,
  overwrite: true,
  prune: false,
  asar: {
    unpackDir: '{node_modules,dist-electron/backend/speech}',
  },
  ignore: [
    /^\/node_modules(?:\/|$)/,
    /^\/(?:\.git|\.pnpm-store|test-results|release-smoke|local-models|src|electron|docs|tests|scripts|\.codex|\.agents)(?:\/|$)/,
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
        if (copied.has(name)) return;
        copied.add(name);
        const destination = path.join(buildPath, 'node_modules', name);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(source, destination, {
          recursive: true,
          filter: (p) =>
            !p.includes('/bin/napi-v6/darwin') &&
            !p.includes('/bin/napi-v6/linux') &&
            !p.includes('\\bin\\napi-v6\\darwin') &&
            !p.includes('\\bin\\napi-v6\\linux'),
        });
        for (const dependency of Object.keys(pkg.dependencies ?? {}))
          await copyPackage(dependency, source);
        for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) {
          if (/sherpa-onnx-(?:darwin|linux|win-ia32)/.test(dependency)) continue;
          try {
            await copyPackage(dependency, source);
          } catch (e) {
            if (!String(e).includes('Cannot find module')) throw e;
          }
        }
      }
      for (const name of ['jose', 'sherpa-onnx-node', 'sherpa-onnx-win-x64'])
        await copyPackage(name);
    },
  ],
  afterComplete: [
    async ({ buildPath }) => {
      await cp(
        path.resolve('local-models/speech'),
        path.join(buildPath, 'resources/models/speech'),
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

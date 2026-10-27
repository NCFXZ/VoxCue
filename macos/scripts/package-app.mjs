import workspace from '../../shared/scripts/workspace.mjs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sparkleTools } from './sparkle-tools.mjs';
const root = workspace.platformRoot;
const require = workspace.platformRequire;
const { packager } = await import(require.resolve('@electron/packager'));
import { signMacApp } from './sign-app.mjs';
import { loadDevelopmentSigning } from './development-signing.mjs';
import { buildQwen } from './build-qwen.mjs';
import { buildCredentials } from './build-credentials.mjs';
import { stageRuntimeDependencies } from './runtime-dependencies.mjs';
const yaml = (await import('node:module')).createRequire(
  require.resolve('electron-updater/package.json'),
)('js-yaml');
const overrides =
  yaml.load(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).overrides ?? {};
const includedDependency = (owner, dependency) => overrides[`${owner}>${dependency}`] !== '-';

export async function buildMacApp(output, publicKey) {
  // Fail before packaging if the established identity is unavailable; never rotate
  // it or fall back to ad-hoc. The separate Sparkle Ed25519 identity is unchanged.
  const signing = await loadDevelopmentSigning();
  await buildCredentials();
  await buildQwen();
  const tools = await sparkleTools();
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const dependencyRoot = await stageRuntimeDependencies(output);
  const paths = await packager({
    dir: root,
    tmpdir: path.join(output, 'packager-temp'),
    out: output,
    name: 'VoxCue',
    platform: 'darwin',
    arch: 'arm64',
    electronVersion: require('electron/package.json').version,
    download: { cacheRoot: path.join(root, '.cache/electron') },
    appBundleId: 'com.voxcue.app',
    appVersion: version,
    buildVersion: version,
    icon: path.join(root, 'public/voxcue.icns'),
    appCopyright: 'Copyright © VoxCue contributors',
    overwrite: false,
    prune: false,
    extendInfo: {
      LSMinimumSystemVersion: '14.2',
      NSMicrophoneUsageDescription: 'VoxCue 在本机转写麦克风，不保存或上传音频。',
      NSAudioCaptureUsageDescription: 'VoxCue 在本机转写系统音频，不保存或上传音频。',
      NSScreenCaptureUsageDescription: 'VoxCue 仅在你点击截图按钮时捕获当前屏幕，不持续录屏。',
      SUPublicEDKey: publicKey,
      SUEnableAutomaticChecks: false,
      SUAutomaticallyUpdate: false,
      SUEnableSystemProfiling: false,
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
    asar: {
      unpackDir:
        '{node_modules,dist-electron/shared/electron/backend/speech,dist-electron/shared/electron/backend/knowledge,dist-electron/shared/electron/contracts,dist-electron/macos/electron/speech}',
    },
    ignore: [
      /\.map$/,
      /^\/node_modules(?:\/|$)/,
      /^\/(?!dist(?:\/|$)|dist-electron(?:\/|$)|public(?:\/|$)|package\.json$)/,
    ],
    afterCopy: [
      async ({ buildPath }) => {
        await cp(path.join(workspace.sharedRoot, 'public'), path.join(buildPath, 'public'), {
          recursive: true,
        });
        await cp(path.join(root, 'public'), path.join(buildPath, 'public'), { recursive: true });
        // Only runtime identity is shipped; developer commands and dependencies are not application data.
        await writeFile(
          path.join(buildPath, 'package.json'),
          JSON.stringify({
            name: 'voxcue',
            productName: 'VoxCue',
            version,
            main: 'dist-electron/shared/electron/main.js',
            type: 'commonjs',
          }),
        );
        const copied = new Set();
        async function copyPackage(name, from = dependencyRoot) {
          // Installed vendor packages stay intact; only the application copy is made lean.
          if (name === 'onnxruntime-web') return;
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
          if (!matches(pkg.os, 'darwin') || !matches(pkg.cpu, 'arm64')) return;
          // Mirror the configured hoisted layout, including nested version conflicts.
          // A package is copied once; flattening different ONNX versions would be incorrect.
          const relative = path.relative(path.join(dependencyRoot, 'node_modules'), source);
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
                !/^bin\/napi-v6\/(?:win32|linux)/.test(relative) &&
                !/^bin\/napi-v6\/darwin\/x64/.test(relative)
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
          '@openai/codex',
          '@openai/codex-darwin-arm64',
          '@github/copilot-sdk',
          '@github/copilot-sdk-darwin-arm64',
          'jose',
          'adm-zip',
          'electron-updater',
          'sherpa-onnx-node',
          'sherpa-onnx-darwin-arm64',
          '@ennuicastr/webrtcaec3.js',
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
  }).finally(() => rm(dependencyRoot, { recursive: true, force: true }));
  if (paths.length !== 1) throw Error('Expected one arm64 application');
  const app = path.join(paths[0], 'VoxCue.app');
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  await cp(
    path.join(tools, 'Sparkle.framework'),
    path.join(contents, 'Frameworks/Sparkle.framework'),
    { recursive: true, verbatimSymlinks: true },
  );
  await mkdir(path.join(resources, 'native'), { recursive: true });
  for (const name of [
    'VoxCue.Audio',
    'VoxCue.ScreenPermission.node',
    'VoxCue.Updater.node',
    'VoxCue.Credentials',
  ])
    await cp(path.join(root, 'native/bin', name), path.join(resources, 'native', name));
  // Only the build's authenticated canonical file set enters the application.
  // File Provider may retain numbered copies; they are never runtime resources.
  const qwenRoot = path.join(root, 'native/bin/qwen');
  const qwenBuild = JSON.parse(await readFile(path.join(qwenRoot, 'build.json'), 'utf8'));
  for (const file of Object.keys(qwenBuild.files)) {
    const destination = path.join(resources, 'native/qwen', file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(qwenRoot, file), destination);
  }
  await writeFile(
    path.join(resources, 'voxcue-components.json'),
    JSON.stringify({ schemaVersion: 1 }),
  );
  await writeFile(
    path.join(resources, 'voxcue-update.json'),
    JSON.stringify({ protocol: 1, repository: 'NCFXZ/VoxCue-releases', publicKey }),
  );
  await mkdir(path.join(resources, 'licenses'), { recursive: true });
  await cp(path.join(tools, 'LICENSE'), path.join(resources, 'licenses/Sparkle.txt'));
  // Keychain continuity uses our fixed certificate; update authenticity still uses Ed25519.
  await signMacApp(app, { signing });
  return app;
}

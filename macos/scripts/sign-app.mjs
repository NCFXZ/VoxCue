import { readdir, open, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadDevelopmentSigning, signLocalCode, verifyLocalApp } from './development-signing.mjs';
import { verifyFixedHardenedCredentials } from './build-hardened-credentials.mjs';
// A fixed local certificate keeps Keychain's designated requirement stable.
// Sign all Mach-O code and nested bundles from inside out, without signing model/data files.
export async function signMacApp(
  app,
  { signing, identifier = 'com.voxcue.app', preserveMetadata = false } = {},
) {
  signing ??= await loadDevelopmentSigning();
  const targets = [];
  const magic = new Set([
    'feedface',
    'feedfacf',
    'cefaedfe',
    'cffaedfe',
    'cafebabe',
    'bebafeca',
    'cafebabf',
    'bfbafeca',
  ]);
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        if (/\.(?:app|framework|xpc)$/.test(entry.name)) targets.push(file);
      } else if (entry.isFile()) {
        const handle = await open(file, 'r');
        try {
          const buffer = Buffer.alloc(4);
          const { bytesRead } = await handle.read(buffer, 0, 4, 0);
          if (bytesRead === 4 && magic.has(buffer.toString('hex'))) targets.push(file);
        } finally {
          await handle.close();
        }
      }
      // Framework symlinks are preserved, never followed outside the app.
    }
  }
  await visit(app);
  targets.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'voxcue-sign-policy-'));
  const policies = new Map();
  for (const [name, keys] of [
    ['jit', ['allow-jit']],
    ['libraries', ['disable-library-validation']],
    ['jit-libraries', ['allow-jit', 'disable-library-validation']],
  ]) {
    const file = path.join(temporary, name + '.plist');
    await writeFile(
      file,
      '<?xml version="1.0"?><plist version="1.0"><dict>' +
        keys.map((key) => '<key>com.apple.security.cs.' + key + '</key><true/>').join('') +
        '</dict></plist>',
    );
    policies.set(name, file);
  }
  try {
    for (const file of [...targets, app]) {
      if (file === path.join(app, 'Contents/Resources/native/VoxCue.Credentials')) {
        // Preserve the standalone helper's exact CDHash across application releases.
        await verifyFixedHardenedCredentials(file, signing);
        continue;
      }
      const relative = path.relative(app, file).replaceAll(path.sep, '/');
      const electronHost =
        file === app ||
        relative === 'Contents/MacOS/VoxCue' ||
        /^Contents\/Frameworks\/VoxCue Helper(?: \((?:Renderer|GPU|Plugin)\))?\.app(?:\/Contents\/MacOS\/VoxCue Helper(?: \((?:Renderer|GPU|Plugin)\))?)?$/.test(
          relative,
        );
      const v8 =
        file === app ||
        relative === 'Contents/MacOS/VoxCue' ||
        /^Contents\/Frameworks\/VoxCue Helper(?: \(Renderer\))?\.app(?:\/Contents\/MacOS\/VoxCue Helper(?: \(Renderer\))?)?$/.test(
          relative,
        ) ||
        relative.endsWith('/copilot-runtime');
      // The fixed self-signed certificate has no Team ID. A real HR dlopen
      // fixture rejects even libraries signed with this very certificate.
      // Limit this necessary exception to hosts that load sealed bundled code;
      // DYLD environment injection and unsigned executable memory stay disabled.
      const libraries =
        electronHost ||
        // The SDK loader dlopens its sealed runtime.node (not shown by otool).
        relative.endsWith('/copilot-runtime') ||
        relative === 'Contents/Resources/native/qwen/voxcue-qwen' ||
        relative === 'Contents/Resources/native/qwen/python/bin/python3.12';
      signLocalCode(file, signing, file === app ? identifier : undefined, {
        preserveMetadata,
        runtime: !preserveMetadata,
        ...(!preserveMetadata && (v8 || libraries)
          ? {
              entitlements: policies.get(
                v8 && libraries ? 'jit-libraries' : v8 ? 'jit' : 'libraries',
              ),
            }
          : {}),
      });
    }
    verifyLocalApp(app, signing, identifier);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

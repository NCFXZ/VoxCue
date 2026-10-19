import { readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { loadDevelopmentSigning, signLocalCode, verifyLocalApp } from './development-signing.mjs';
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
  for (const file of [...targets, app]) {
    signLocalCode(file, signing, file === app ? identifier : undefined, { preserveMetadata });
  }
  verifyLocalApp(app, signing, identifier);
}

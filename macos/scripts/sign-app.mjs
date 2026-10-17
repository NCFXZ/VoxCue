import { readdir, open } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
// Non-hardened ad-hoc distribution has no Team ID and needs no restricted entitlements.
// Sign all Mach-O code and nested bundles from inside out, without signing model/data files.
export async function signMacApp(app) {
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
    const result = spawnSync(
      '/usr/bin/codesign',
      ['--force', '--sign', '-', '--options', '0', file],
      { encoding: 'utf8' },
    );
    if (result.error || result.status)
      throw result.error ?? Error(`Ad-hoc signing failed: ${result.stderr}`);
  }
  const verification = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {
    encoding: 'utf8',
  });
  if (verification.error || verification.status)
    throw verification.error ?? Error(verification.stderr);
}

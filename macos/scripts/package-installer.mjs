import workspace from '../../shared/scripts/workspace.mjs';
import { buildMacApp } from './package-app.mjs';
import { updateSigningKey } from './update-signing.mjs';
import { sparkleTools } from './sparkle-tools.mjs';
import { createMacDmg } from './dmg.mjs';
import { mkdtemp, mkdir, rm, readFile, writeFile, stat, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root = workspace.platformRoot;
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status) throw result.error ?? Error(`${command}: ${result.stderr}`);
  return result.stdout;
};
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const output = path.join(root, 'release', version);
if (await lstat(output).catch(() => false))
  throw Error('Release output already exists; do not overwrite an existing release');
const { key, publicKey, privateKeyFile } = await updateSigningKey({ create: true });
const tools = await sparkleTools();
const stage = await mkdtemp(path.join(os.tmpdir(), 'voxcue-package-'));
let completed = false;
async function cleanup() {
  await rm(stage, { recursive: true, force: true });
  if (!completed) await rm(output, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(1));
  });
try {
  const app = await buildMacApp(path.join(stage, 'bundle'), publicKey);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  await mkdir(output, { recursive: true });
  const filename = `VoxCue-${version}-arm64.zip`;
  const zip = path.join(output, filename);
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const edSignature = run(path.join(tools, 'bin/sign_update'), [
    '--ed-key-file',
    privateKeyFile,
    '-p',
    zip,
  ]).trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(edSignature)) throw Error('Invalid Sparkle signing output');
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(zip)) hash.update(chunk);
  const file = {
    url: filename,
    size: (await stat(zip)).size,
    sha512: hash.digest('base64'),
    edSignature,
  };
  const minimumSystemVersion = '14.2';
  const payload = Buffer.from(
    JSON.stringify([
      'voxcue-macos-update-v1',
      version,
      file.url,
      file.size,
      file.sha512,
      file.edSignature,
      minimumSystemVersion,
    ]),
  );
  file.voxcueSignature = sign(null, payload, key).toString('base64');
  await writeFile(
    path.join(output, 'latest-mac.yml'),
    JSON.stringify({ version, minimumSystemVersion, files: [file] }, null, 2) + '\n',
  );
  await createMacDmg(app, path.join(output, `VoxCue-${version}-arm64.dmg`), stage, version);
  completed = true;
  console.log(`Created signed-update ZIP, DMG and latest-mac.yml in ${output}`);
} finally {
  await cleanup();
}

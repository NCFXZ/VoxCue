import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { createMacDmg, dmgLayout, withMountedDmg } from '../../scripts/dmg.mjs';
import { runDmgTool as run } from '../../scripts/dmg-tools.mjs';
import { mkdir, writeFile, cp, readFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const app = path.join(testRoot, 'VoxCue.app');
await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
await mkdir(path.join(app, 'Contents/Resources'));
await cp(
  path.join(workspace.platformRoot, 'public/voxcue.icns'),
  path.join(app, 'Contents/Resources/voxcue.icns'),
);
const source = path.join(testRoot, 'stub.c');
await writeFile(source, 'int main(void) { return 0; }\n');
run('/usr/bin/xcrun', [
  'clang',
  '-arch',
  'arm64',
  source,
  '-o',
  path.join(app, 'Contents/MacOS/VoxCue'),
]);
await writeFile(
  path.join(app, 'Contents/Info.plist'),
  `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.voxcue.dmg-fixture</string><key>CFBundleExecutable</key><string>VoxCue</string><key>CFBundleName</key><string>VoxCue</string><key>CFBundleIconFile</key><string>voxcue.icns</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
);
run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
const original = await readFile(path.join(app, 'Contents/MacOS/VoxCue'));
const stage = path.join(testRoot, 'stage');
await mkdir(stage);
const image = path.join(testRoot, 'VoxCue-preview.dmg');
const { tools, layout } = await createMacDmg(app, image, stage, '0.2.2');
const relocated = path.join(testRoot, 'relocated');
await mkdir(relocated);
const relocatedImage = path.join(relocated, 'VoxCue-preview.dmg');
await rename(image, relocatedImage);
const mount = path.join(testRoot, 'check-mount');
await mkdir(mount);
await withMountedDmg(
  relocatedImage,
  mount,
  async () => {
    const metadata = JSON.parse(dmgLayout(tools, 'read', mount));
    assert.equal(metadata.window.ShowToolbar, false);
    assert.equal(metadata.window.ShowSidebar, false);
    assert.equal(metadata.window.ShowStatusBar, false);
    assert.equal(metadata.window.WindowBounds, '{{180, 140}, {600, 428}}');
    assert.equal(metadata.iconView.iconSize, 88);
    assert.equal(metadata.iconView.arrangeBy, 'none');
    assert.equal(metadata.iconView.backgroundType, 2);
    assert.deepEqual(metadata.positions, { 'VoxCue.app': [170, 212], Applications: [430, 212] });
    assert.equal(metadata.destination, '/Applications');
    assert.equal(metadata.background.filename, 'background.tiff');
    assert.ok(metadata.background.bytes > 0);
    assert.deepEqual((await readdir(mount)).filter((name) => !name.startsWith('.')).sort(), [
      'Applications',
      'VoxCue.app',
    ]);
    assert.deepEqual(
      await readFile(path.join(mount, 'VoxCue.app/Contents/MacOS/VoxCue')),
      original,
    );
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(mount, 'VoxCue.app')]);
    const info = run('/usr/bin/tiffutil', [
      '-info',
      path.join(mount, '.background/background.tiff'),
    ]);
    assert.equal((info.match(/^Directory at /gm) ?? []).length, 2);
    assert.match(info, /Image Width: 600 Image Length: 400/);
    assert.match(info, /Image Width: 1200 Image Length: 800/);
    assert.match(info, /Resolution: 144, 144/);
  },
  true,
);
// A canceled owner must detach its temporary volume before removing its root.
const canceled = path.join(testRoot, 'cancel-mounted.mjs');
await writeFile(
  canceled,
  `
import {testRoot} from ${JSON.stringify(pathToFileURL(path.join(workspace.sharedRoot, 'test/scripts/test-workspace.mjs')).href)};
import {withMountedDmg} from ${JSON.stringify(pathToFileURL(path.join(workspace.platformRoot, 'scripts/dmg.mjs')).href)};
import {mkdir} from 'node:fs/promises';
const mount = testRoot + '/mounted';
await mkdir(mount);
await withMountedDmg(${JSON.stringify(relocatedImage)}, mount, () => {
  setInterval(() => {}, 1000);
  console.log(JSON.stringify({root:testRoot,mount}));
  return new Promise(() => {});
}, true);
`,
);
const child = spawnTestProcess(process.execPath, [canceled], { stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = '';
child.stderr.on('data', (value) => (diagnostics += value));
const lines = createInterface({ input: child.stdout });
const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
try {
  const [line] = await Promise.race([
    once(lines, 'line'),
    once(child, 'exit').then(() => {
      throw Error('DMG cancellation fixture exited before mounting: ' + diagnostics);
    }),
  ]);
  const owned = JSON.parse(line);
  const exit = once(child, 'exit');
  child.kill('SIGTERM');
  assert.equal((await exit)[0], 143, diagnostics);
  assert.equal(existsSync(owned.root), false);
  assert.equal(run('/usr/bin/hdiutil', ['info']).includes(owned.mount), false);
} finally {
  clearTimeout(timer);
  lines.close();
  if (child.exitCode === null) child.kill('SIGTERM');
}
console.log(
  'PASS: compressed/relocated DMG, embedded Finder layout, 1x/2x artwork, Applications target, unchanged signed application and cancellation detach/cleanup.',
);
assert.equal(layout.width, 600);
if (process.argv.includes('--preview')) {
  const png = run(tools.artwork, [tools.layout, tools.logo, '--preview', '/Applications'], {
    encoding: null,
  });
  console.log('VOXCUE_DMG_PREVIEW:' + png.toString('base64'));
}

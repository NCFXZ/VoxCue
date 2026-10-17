// Deterministic size/format conversion of the supplied artwork; no redesign.
const { app, nativeImage } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  await import('./workspace.mjs'); // Reject execution from the other platform's tree.
  const source = process.argv[2];
  if (!source) throw Error('Pass the supplied PNG path.');
  const logo = nativeImage.createFromPath(source);
  if (logo.isEmpty()) throw Error('Cannot read logo.');
  const directory = path.resolve(__dirname, '../public');
  writeFileSync(path.join(directory, 'voxcue-source.png'), readFileSync(source));
  const png = logo.resize({ width: 512, height: 512, quality: 'best' }).toPNG();
  writeFileSync(path.join(directory, 'voxcue.png'), png);
  // Renderer imports this copy so Vite fingerprints updated artwork.
  writeFileSync(path.resolve(__dirname, '../src/assets/voxcue.png'), png);
  const sizes = process.platform === 'win32' ? [16, 24, 32, 48, 64, 128, 256] : [];
  const entries = sizes.map((size) =>
    logo.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  );
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((entry, i) => {
    const at = 6 + i * 16,
      size = sizes[i];
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(entry.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += entry.length;
  });
  if (process.platform === 'win32')
    writeFileSync(
      path.resolve(__dirname, '../../windows/public/voxcue.ico'),
      Buffer.concat([header, ...entries]),
    );
  console.log(JSON.stringify({ sourceSize: logo.getSize(), pngSize: 512, icoSizes: sizes }));
  app.quit();
});

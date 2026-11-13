import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const asar = createRequire(import.meta.url)('@electron/asar');

export async function checkPackagedRenderer(archive) {
  const read = (file) => asar.extractFile(archive, path.join('dist', file));
  const manifest = JSON.parse(read('.vite/manifest.json'));
  const expected = new Set(['.vite/manifest.json']);
  const pages = [];
  for (const chunk of Object.values(manifest)) {
    for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])])
      expected.add(file);
    if (chunk.isEntry && chunk.src?.endsWith('.html')) {
      expected.add(chunk.src);
      pages.push(chunk.src);
    }
  }
  assert.deepEqual(pages.sort(), ['index.html', 'mobile.html']);
  const publicRoot = path.resolve('../shared/public');
  for (const file of await readdir(publicRoot, { recursive: true, withFileTypes: true })) {
    if (file.isFile())
      expected.add(
        path.relative(publicRoot, path.join(file.parentPath, file.name)).replaceAll('\\', '/'),
      );
  }
  const actual = asar
    .listPackage(archive)
    .map((file) => file.replaceAll('\\', '/'))
    .filter(
      (file) =>
        file.startsWith('/dist/') &&
        !('files' in asar.statFile(archive, path.normalize(file.slice(1)))),
    )
    .map((file) => file.slice('/dist/'.length));
  assert.deepEqual(
    actual.sort(),
    [...expected].sort(),
    'Renderer payload differs from Vite outputs and public assets',
  );
  for (const file of expected)
    assert.ok(
      read(file).equals(await readFile(path.join('dist', file))),
      'Renderer bytes differ: ' + file,
    );
  for (const page of pages) {
    for (const [, reference] of read(page)
      .toString('utf8')
      .matchAll(/\b(?:href|src)="\.\/([^"]+)"/g))
      assert.ok(expected.has(reference), page + ' refers to a missing asset: ' + reference);
  }
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ts = createRequire(import.meta.url)('typescript');

// A utility process launched from app.asar.unpacked resolves its relative imports
// on the physical file system. A copy inside app.asar cannot satisfy them.
export function checkKnowledgeProcessClosure(hasPhysicalFile) {
  const root = path.resolve('dist-electron');
  const pending = [path.join(root, 'shared/electron/backend/knowledge/process.js')];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const relative = path.relative(root, file);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'Knowledge import left compiled output');
    const entry = 'dist-electron/' + relative.split(path.sep).join('/');
    assert.ok(hasPhysicalFile(entry), 'Missing physical knowledge process module: ' + entry);
    if (path.extname(file) !== '.js') continue;
    const resolve = createRequire(file).resolve;
    const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
    for (const { fileName } of imports) {
      if (fileName.startsWith('./') || fileName.startsWith('../')) pending.push(resolve(fileName));
    }
  }
}

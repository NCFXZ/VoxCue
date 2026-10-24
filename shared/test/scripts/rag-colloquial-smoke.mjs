import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import workspace from '../../scripts/workspace.mjs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = workspace.platformRequire;
const backend = path.join(workspace.platformRoot, 'dist-electron/shared/electron');
const { ComponentService, componentLocation } = require(
  path.join(backend, 'backend/components/service.js'),
);
const { packagesFor } = require(path.join(backend, 'backend/components/catalog.js'));
const packages = packagesFor(process.platform, process.arch).filter((item) => item.id === 'rag');
assert.equal(packages.length, 1);
const modelRoot = path.join(testRoot, 'models');
let lastProgress = -1;
const service = new ComponentService({
  root: modelRoot,
  packages,
  managed: true,
  fetch,
  emit: (state) => {
    const current = state.items.find((item) => item.id === 'rag');
    if (!current?.bytes) return;
    const progress = Math.floor((current.received / current.bytes) * 10);
    if (progress > lastProgress) {
      lastProgress = progress;
      console.log(`Fixed public model download: ${progress * 10}%`);
    }
  },
});
try {
  console.log('Preparing and verifying the fixed public E5 model in temporary storage.');
  const state = await service.download('rag');
  assert.equal(state.phase, 'ready', state.error);
} finally {
  service.dispose();
}
const model = path.join(componentLocation(modelRoot, packages[0]), 'files', packages[0].directory);
const ts = require('typescript');
for (const [source, target] of [
  ['rag-quality.ts', 'rag-quality.js'],
  ['rag-colloquial.ts', 'colloquial.cjs'],
]) {
  const text = await readFile(new URL('../fixtures/' + source, import.meta.url), 'utf8');
  await writeFile(
    path.join(testRoot, target),
    ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
}
await writeFile(
  path.join(testRoot, 'config.json'),
  JSON.stringify({ backend, model, root: testRoot }),
);
await copyFile(
  new URL('./rag-colloquial-check.cjs', import.meta.url),
  path.join(testRoot, 'main.cjs'),
);
await writeFile(
  path.join(testRoot, 'package.json'),
  JSON.stringify({ name: 'voxcue-colloquial-audit', version: '1.0.0', main: 'main.cjs' }),
);
const entry = await offlineElectronEntry(path.join(testRoot, 'main.cjs'));
await new Promise((resolve, reject) => {
  let warnings = 0;
  const pending = { stdout: '', stderr: '' };
  const output = (source, chunk, flush = false) => {
    pending[source] += chunk;
    const lines = pending[source].split(/\r?\n/);
    pending[source] = flush ? '' : lines.pop();
    for (const line of lines) {
      if (line.includes('lance::dataset::scanner') && line.includes('Deprecation warning'))
        warnings++;
      else if (line) (source === 'stderr' ? console.error : console.log)(line);
    }
  };
  const child = spawnTestProcess(require('electron'), [entry], {
    cwd: workspace.platformRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, RUST_LOG: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => output('stdout', chunk));
  child.stderr.on('data', (chunk) => output('stderr', chunk));
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(Error('Colloquial RAG audit timed out'));
  }, 300000);
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    output('stdout', '', true);
    output('stderr', '', true);
    if (warnings)
      console.log(`Existing Lance scoring-autoprojection deprecation warnings: ${warnings}.`);
    code === 0 ? resolve() : reject(Error(`Colloquial RAG audit failed (${code})`));
  });
});
console.log('Audit finished; temporary model, index, documents and profile are removed on exit.');

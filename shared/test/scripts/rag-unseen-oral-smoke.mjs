import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import workspace from '../../scripts/workspace.mjs';
import { copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = workspace.platformRequire;
const backend =
  process.env.VOXCUE_RAG_TEST_BACKEND ||
  path.join(workspace.platformRoot, 'dist-electron/shared/electron');
const corpusFile = process.argv.includes('--public-transfer')
  ? 'rag-public-transfer.ts'
  : process.argv.includes('--public')
    ? 'rag-public-interview.ts'
    : process.argv.includes('--transfer')
      ? 'rag-oral-transfer.ts'
      : 'rag-unseen-oral.ts';
const sha = (value) => createHash('sha256').update(value).digest('hex');
async function fingerprint() {
  const result = {};
  for (const directory of [path.join(workspace.sharedRoot, 'electron'), backend]) {
    for (const file of (await readdir(directory, { recursive: true })).sort()) {
      if (!/\.(?:ts|js)$/.test(file)) continue;
      const absolute = path.join(directory, file);
      result[path.relative(workspace.repositoryRoot, absolute)] = sha(await readFile(absolute));
    }
  }
  return result;
}
const frozen = await fingerprint();
const corpusSource = await readFile(new URL('../fixtures/' + corpusFile, import.meta.url), 'utf8');
const corpusSha256 = sha(corpusSource);
console.log(
  'UNSEEN_FROZEN',
  JSON.stringify({
    productionSha256: sha(JSON.stringify(frozen)),
    productionFiles: Object.keys(frozen).length,
    corpusSha256,
  }),
);
const ts = require('typescript');
const compiled = ts.transpileModule(corpusSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);
await writeFile(path.join(testRoot, 'unseen.cjs'), compiled.outputText);
const fixture = require(path.join(testRoot, 'unseen.cjs'));
assert.equal(fixture.cases.length, fixture.expectedCaseCount ?? 240);
assert.equal(fixture.documents.length, fixture.expectedDocumentCount ?? 20);
assert.equal(new Set(fixture.cases.map((c) => c.id)).size, fixture.cases.length);
if (fixture.protocol) console.log('PUBLIC_PROTOCOL', JSON.stringify(fixture.protocol));
console.log(
  'UNSEEN_LABELS_FROZEN',
  JSON.stringify({
    dataSha256: sha(JSON.stringify({ documents: fixture.documents, cases: fixture.cases })),
    groups: Object.fromEntries(
      [...new Set(fixture.cases.map((c) => c.group))].map((group) => [
        group,
        fixture.cases.filter((c) => c.group === group).length,
      ]),
    ),
  }),
);
const { ComponentService, componentLocation } = require(
  path.join(backend, 'backend/components/service.js'),
);
const { packagesFor } = require(path.join(backend, 'backend/components/catalog.js'));
const packages = packagesFor(process.platform, process.arch).filter((p) => p.id === 'rag');
assert.equal(packages.length, 1);
let lastProgress = -1;
const modelRoot = path.join(testRoot, 'models');
const service = new ComponentService({
  root: modelRoot,
  packages,
  managed: true,
  fetch,
  emit: (state) => {
    const current = state.items.find((p) => p.id === 'rag');
    if (!current?.bytes) return;
    const progress = Math.floor((current.received / current.bytes) * 10);
    if (progress > lastProgress) {
      lastProgress = progress;
      console.log(`Fixed public model download: ${progress * 10}%`);
    }
  },
});
try {
  console.log('Preparing the fixed public E5 model in fresh temporary storage.');
  const state = await service.download('rag');
  assert.equal(state.phase, 'ready', state.error);
} finally {
  service.dispose();
}
const model = path.join(componentLocation(modelRoot, packages[0]), 'files', packages[0].directory);
await writeFile(
  path.join(testRoot, 'config.json'),
  JSON.stringify({ backend, model, root: testRoot, corpusSha256 }),
);
await copyFile(
  new URL('./rag-unseen-oral-check.cjs', import.meta.url),
  path.join(testRoot, 'main.cjs'),
);
await writeFile(
  path.join(testRoot, 'package.json'),
  JSON.stringify({ name: 'voxcue-unseen-oral-audit', version: '1.0.0', main: 'main.cjs' }),
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
    reject(Error('Unseen oral audit timed out'));
  }, 420000);
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
    code === 0 ? resolve() : reject(Error(`Unseen oral audit failed (${code})`));
  });
});
assert.deepEqual(
  await fingerprint(),
  frozen,
  'Production source and compiled backend must remain frozen',
);
assert.equal(
  sha(await readFile(new URL('../fixtures/' + corpusFile, import.meta.url))),
  corpusSha256,
  'Do not change holdout data or labels after observing results',
);
console.log(
  'UNSEEN_FREEZE_VERIFIED: production and corpus unchanged; temporary model/index/profile removed on exit.',
);

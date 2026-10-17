import workspace from './workspace.mjs';
import fs from 'node:fs';
import path from 'node:path';
const { repositoryRoot, platformRoot, platformName } = workspace;
const other = platformName === 'macos' ? 'windows' : 'macos';
const violations = [];
const output = path.join(platformRoot, 'dist-electron');
if (fs.existsSync(output))
  for (const entry of fs.readdirSync(output))
    if (!entry.startsWith('.') && !['shared', platformName].includes(entry))
      violations.push(`Foreign Electron output: ${platformName}/dist-electron/${entry}`);
const skipped = new Set([
  'node_modules',
  '.pnpm-store',
  '.tools',
  '.cache',
  'dist',
  'dist-electron',
  'results',
  'recovery',
  'benchmarks',
  'local-models',
  'VoxCue.app',
]);
let inspected = 0;
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || skipped.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      violations.push(`Redirected project source: ${path.relative(repositoryRoot, file)}`);
    } else if (entry.isDirectory()) visit(file);
    else {
      inspected++;
      if (
        platformName === 'macos' &&
        /\.(?:exe|dll|pdb|lib|ico|cs|csproj|ps1|cmd|bat)$/i.test(entry.name)
      )
        violations.push(`Windows-only project file: ${path.relative(repositoryRoot, file)}`);
      if (
        platformName === 'windows' &&
        file.startsWith(platformRoot + path.sep) &&
        /\.(?:mm|swift|dylib)$/i.test(entry.name)
      )
        violations.push(`Mac-only project file: ${path.relative(repositoryRoot, file)}`);
    }
  }
}
visit(path.join(repositoryRoot, 'shared'));
visit(platformRoot);
const foreignLegacy = path.join(repositoryRoot, other, 'dist-electron', platformName);
if (fs.existsSync(foreignLegacy))
  console.warn(
    `Read-only legacy output on ${other}: dist-electron/${platformName}; rebuild on ${other} after sync:workspace.`,
  );
for (const violation of violations) console.error(violation);
console.log(
  `Platform layout: ${inspected} owned/shared project files, ${violations.length} violations. Vendor contents, recovery snapshots and private/history data are excluded.`,
);
if (violations.length) process.exitCode = 1;

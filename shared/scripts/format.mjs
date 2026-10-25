import workspace from './workspace.mjs';
import { spawnSync } from 'node:child_process';
const { platformName, platformRoot, platformRequire } = workspace;
const targets = [
  '../shared/src/**/*.{ts,tsx,css}',
  '../shared/electron/**/*.ts',
  '../shared/scripts/*.{mjs,cjs}',
  '../shared/test/{unit,renderer,scripts}/**/*.{ts,tsx,mjs,cjs}',
  `../${platformName}/electron/**/*.ts`,
  `../${platformName}/scripts/*.mjs`,
  `../${platformName}/test/{unit,scripts,fixtures}/**/*.{ts,tsx,mjs,cjs}`,
];
if (platformName === 'macos') targets.push('../macos/src/icons.tsx', '../macos/src/symbols.json');
if (process.argv.includes('--list'))
  console.log(JSON.stringify({ platform: platformName, targets }));
else {
  const result = spawnSync(
    process.execPath,
    [
      platformRequire.resolve('prettier/bin/prettier.cjs'),
      '--config',
      '../.prettierrc.json',
      '--write',
      ...targets,
    ],
    { cwd: platformRoot, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

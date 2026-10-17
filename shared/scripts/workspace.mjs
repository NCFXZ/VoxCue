import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.relative(repositoryRoot, process.cwd()).split(path.sep)[0];
const platformName =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : undefined;
if (!platformName) throw Error('Unsupported desktop host.');
if (['windows', 'macos'].includes(directory) && directory !== platformName)
  throw Error(
    `${directory}/ is read-only on ${process.platform}; run tools from ${platformName}/ or the repository root.`,
  );
const platformRoot = path.join(repositoryRoot, platformName);
const sharedRoot = path.join(repositoryRoot, 'shared');
const platformRequire = createRequire(path.join(platformRoot, 'package.json'));

export default { repositoryRoot, sharedRoot, platformName, platformRoot, platformRequire };

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import workspace from '../../scripts/workspace.mjs';

// Client fixtures can consume a separate, unchanged reference without replacing
// an older or locally modified server checkout. Never run backend test commands.
const root = process.env.VOXCUE_TEST_SERVER_ROOT
  ? path.resolve(process.env.VOXCUE_TEST_SERVER_ROOT)
  : path.join(workspace.repositoryRoot, '..', 'VoxCue-server');
const revision = '3bceb615dbba900f669322c301fc4b5b473dfb15';
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
if (
  JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version !== '0.5.3' ||
  git('rev-parse', 'HEAD') !== revision ||
  git('status', '--porcelain', '--untracked-files=no')
)
  throw Error(
    'Client integration requires the unchanged 0.5.3 server 3bceb61 reference. Set VOXCUE_TEST_SERVER_ROOT to that checkout; do not modify the server.',
  );
const load = (name) => import(pathToFileURL(path.join(root, 'src', name + '.ts')).href);
export const { Store } = await load('store');
export const { Auth } = await load('auth');
export const { loadConfig } = await load('config');
export const { createApi } = await load('http');
export const { Outbox } = await load('outbox');
export const { Services } = await load('services');
export const { routes } = await load('routes');

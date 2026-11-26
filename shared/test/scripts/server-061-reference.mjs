import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';

// A separate reference lets the same transfer UI exercise the published protocol
// while retaining the old-server compatibility fixture and its Git pin.
const root = path.resolve(process.env.VOXCUE_TEST_SERVER_ROOT ??
  path.join(workspace.repositoryRoot, '..', 'VoxCue-server'));
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'voxcue-account-server');
assert.equal(manifest.version, '0.6.1');
const revision = '3440a2517ad3e4d2ee486c76023d229a0ec17fa8';
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== revision || git('status', '--porcelain', '--untracked-files=no'))
  throw Error(
    'Client integration requires the unchanged 0.6.1 server 3440a25 reference. Set VOXCUE_TEST_SERVER_ROOT to that checkout; do not modify the server.',
  );
const load = (name) => import(pathToFileURL(path.join(root, 'src', name + '.ts')).href);
export const { Store } = await load('store');
export const { Auth } = await load('auth');
export const { Services } = await load('services');
export const { loadConfig } = await load('config');
export const { createApi } = await load('http');
export const { routes } = await load('routes');

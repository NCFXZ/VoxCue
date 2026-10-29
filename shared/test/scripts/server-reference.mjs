import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import workspace from '../../scripts/workspace.mjs';

// Client fixtures can consume a separate, unchanged reference without replacing
// an older or locally modified server checkout. Never run backend test commands.
const root = process.env.VOXCUE_TEST_SERVER_ROOT
  ? path.resolve(process.env.VOXCUE_TEST_SERVER_ROOT)
  : path.join(workspace.sharedRoot, 'server');
const revision = '472541cc80c77439f02c45d0bf0aed913b036134';
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== revision || git('status', '--porcelain', '--untracked-files=no'))
  throw Error(
    'Client integration requires an unchanged server 472541c reference. Set VOXCUE_TEST_SERVER_ROOT to an isolated fixed checkout; do not modify the existing server.',
  );
const load = (name) => import(pathToFileURL(path.join(root, 'src', name + '.ts')).href);
export const { Store } = await load('store');
export const { Auth } = await load('auth');
export const { loadConfig } = await load('config');
export const { createApi } = await load('http');
export const { Outbox } = await load('outbox');
export const { Services } = await load('services');
export const { routes } = await load('routes');

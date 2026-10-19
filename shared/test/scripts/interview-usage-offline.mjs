import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const full = process.argv.includes('--full');
if (process.argv.slice(2).some((argument) => argument !== '--full'))
  throw Error('Only --full is supported');
// Guard the entire Node test tree, including workers. The full unit matrix
// also uses HTTP fixtures bound exclusively to 127.0.0.1; external transport
// remains blocked before DNS, including redirects from a local fixture.
const guard = path.join(testRoot, 'offline-network-guard.cjs');
await writeFile(
  guard,
  `
const deny = () => { throw Error('Offline regression forbids network access'); };
const loopback = ${full};
const localUrl = value => {
  try {
    const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch { return false; }
};
const fetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => loopback && localUrl(input) ? fetch(input, ...args) : deny();
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  for (const method of ['request', 'get']) {
    const original = transport[method];
    transport[method] = function(input, ...args) {
      const local = typeof input === 'object' && !(input instanceof URL)
        ? (input.hostname ?? input.host) === '127.0.0.1' && !input.socketPath
        : localUrl(input);
      return loopback && name === 'node:http' && local
        ? original.call(this, input, ...args) : deny();
    };
  }
}
const socket = require('node:net').Socket.prototype;
const connect = socket.connect;
socket.connect = function(...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === 'object' ? options.host : args[1];
  const port = typeof options === 'object' ? options.port : options;
  if (!loopback || host !== '127.0.0.1' || !Number.isInteger(Number(port)) || Number(port) <= 0 || Number(port) > 65535 || options?.path) return deny();
  return connect.apply(this, args);
};
require('node:tls').connect = deny;
require('node:module').syncBuiltinESMExports();
`,
);
const names = [
  'interview-usage-offline',
  'interview-history-selection',
  'speech',
  'speech-store',
  'interview-context',
  'interview-screenshot-store',
  'interview-settings',
  'knowledge-core',
  'knowledge-host',
  'knowledge-coordinator',
  'rag',
  'rag-tools',
  'chat',
  'chat-responses',
  'chat-progress',
  'chat-summary',
];
const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--require ' + JSON.stringify(guard)]
    .filter(Boolean)
    .join(' '),
  RUST_LOG: process.env.RUST_LOG ?? 'error',
};
const wait = (child) =>
  new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
const preflight = spawnTestProcess(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { get } from 'node:https';
import { Socket } from 'node:net';
import { connect } from 'node:tls';
for (const attempt of [
  () => fetch('https://example.invalid'),
  () => request('http://example.invalid'),
  () => get('https://example.invalid'),
  () => new Socket().connect({host:'example.invalid',port:443}),
  () => connect({host:'example.invalid',port:443}),
]) assert.throws(attempt, /Offline regression forbids network access/);
console.log('Offline network guard verified; external transports blocked.');
`,
  ],
  { cwd: workspace.platformRoot, stdio: 'inherit', env },
);
if (await wait(preflight)) throw Error('Offline guard preflight failed');
console.log(
  full
    ? 'Full offline unit/renderer matrix: 127.0.0.1 HTTP fixtures only; temporary files cleaned at exit.'
    : 'Offline interview regression: all network transports blocked; synthetic input/provider; temporary files cleaned at exit.',
);
const child = spawnTestProcess(
  process.execPath,
  [
    workspace.platformRequire.resolve('vitest/vitest.mjs'),
    'run',
    '--config',
    path.join(workspace.sharedRoot, 'vitest.config.mjs'),
    ...(full
      ? []
      : names.map((name) => path.join(workspace.sharedRoot, 'test/unit', name + '.test.ts'))),
  ],
  {
    cwd: workspace.platformRoot,
    stdio: 'inherit',
    env,
  },
);
process.exitCode = await wait(child);

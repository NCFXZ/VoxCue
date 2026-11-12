import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const full = process.argv.includes('--full');
if (process.argv.slice(2).some((argument) => argument !== '--full'))
  throw Error('Only --full is supported');
// Guard the entire Node test tree, including workers. The full unit matrix
// also uses loopback, its own exact private-interface listeners and bounded
// component IPC leases. Other hosts/ports and TLS stay blocked before DNS,
// including redirects from a local fixture.
const guard = path.join(testRoot, 'offline-network-guard.cjs');
await writeFile(
  guard,
  String.raw`
const deny = () => { throw Error('Offline regression forbids network access'); };
const loopback = ${full};
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const temporary = fs.realpathSync(os.tmpdir());
const servers = new Set();
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
  const started = () => servers.add(this), stopped = () => servers.delete(this);
  this.once('listening', started); this.once('close', stopped);
  try { return listen.apply(this, args); }
  catch(error) { this.removeListener('listening', started); this.removeListener('close', stopped); throw error; }
};
const selfIPv4 = host => Object.values(os.networkInterfaces()).flat().some(value =>
  value && value.family === 'IPv4' && value.address === host);
const localTcp = (host, port) => {
  if (!loopback || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) return false;
  if (host === '127.0.0.1') return true;
  if (!selfIPv4(host)) return false;
  return [...servers].some(server => {
    const address = server.address();
    return server.listening && address && typeof address !== 'string' && address.address === host && address.port === Number(port);
  });
};
const componentIpc = value => {
  if (!loopback || typeof value !== 'string') return false;
  const registered = () => [...servers].some(server => server.listening && server.address() === value);
  const prefix = '\\\\.\\pipe\\voxcue-component-';
  if (process.platform === 'win32') return value.startsWith(prefix) && /^[a-f0-9]{32}$/.test(value.slice(prefix.length)) && registered();
  if (!/^vcc-[a-f0-9]{32}$/.test(path.basename(value))) return false;
  try {
    if (fs.realpathSync(path.dirname(value)) !== temporary) return false;
  } catch { return false; }
  try {
    const info = fs.lstatSync(value);
    return info.isSocket() && !info.isSymbolicLink() && info.uid === process.getuid() && info.nlink === 1 && registered();
  } catch(error) { return error.code === 'ENOENT'; }
};
const localUrl = value => {
  try {
    const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
    return url.protocol === 'http:' && localTcp(url.hostname, url.port || 80);
  } catch { return false; }
};
const fetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => localUrl(input) ? fetch(input, ...args) : deny();
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  for (const method of ['request', 'get']) {
    const original = transport[method];
    transport[method] = function(input, ...args) {
      const local = input && typeof input === 'object' && !(input instanceof URL)
        ? localTcp(input.hostname ?? input.host, input.port ?? 80) && !input.socketPath
        : localUrl(input);
      return name === 'node:http' && local ? original.call(this, input, ...args) : deny();
    };
  }
}
const socket = net.Socket.prototype, connect = socket.connect;
socket.connect = function(...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const endpoint = options && typeof options === 'object' ? (typeof options.path === 'string' ? options.path : undefined) : typeof options === 'string' && !Number.isInteger(Number(options)) ? options : undefined;
  if (endpoint !== undefined) return componentIpc(endpoint) ? connect.apply(this, args) : deny();
  const host = options && typeof options === 'object' ? options.host : args[1];
  const port = options && typeof options === 'object' ? options.port : options;
  return localTcp(host, port) ? connect.apply(this, args) : deny();
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
  'rag-reliability',
  'rag-accuracy',
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
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
for (const attempt of [
  () => fetch('https://example.invalid'),
  () => request('http://example.invalid'),
  () => get('https://example.invalid'),
  () => new Socket().connect({host:'example.invalid',port:443}),
  () => connect({host:'example.invalid',port:443}),
]) assert.throws(attempt, /Offline regression forbids network access/);
for (const attempt of [
  () => fetch('http://192.0.2.1:19381'),
  () => request({hostname:'192.0.2.1',port:19381}),
  () => new Socket().connect('/private/tmp/not-a-component-lease'),
]) assert.throws(attempt, /Offline regression forbids network access/);
if (${full}) {
  const {createServer} = await import('node:http');
  const {networkInterfaces} = await import('node:os');
  const host = Object.values(networkInterfaces()).flat().find(value =>
    value && value.family === 'IPv4' && !value.internal)?.address;
  if (host) {
    const server = createServer((request,response)=>{
      if(request.url==='/redirect'){response.writeHead(302,{Location:'https://example.invalid/'});response.end();}
      else{response.writeHead(204);response.end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,resolve);});
    const port = server.address().port, origin = 'http://'+host+':'+port;
    try {
      assert.equal((await fetch(origin)).status,204);
      assert.throws(()=>fetch('http://'+host+':'+(port===65535?port-1:port+1)),/Offline regression forbids network access/);
      await assert.rejects(fetch(origin+'/redirect'),/fetch failed/);
    } finally {await new Promise(resolve=>server.close(resolve));}
    assert.throws(()=>fetch(origin),/Offline regression forbids network access/);
  }
  if (process.platform !== 'win32') {
    const { createServer } = await import('node:net');
    const { Worker } = await import('node:worker_threads');
    const { rm } = await import('node:fs/promises');
    const endpoint = path.join(tmpdir(), 'vcc-'+randomBytes(16).toString('hex'));
    const server = createServer(socket=>socket.destroy());
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
    try {
      await new Promise((resolve,reject)=>{
        const socket = new Socket();
        socket.once('error',reject);
        socket.connect(endpoint,()=>{socket.destroy();resolve();});
      });
    } finally {await new Promise(resolve=>server.close(resolve));}
    await new Promise((resolve,reject)=>{
      const socket = new Socket();
      socket.once('error',error=>{socket.destroy();try{assert.equal(error.code,'ENOENT');resolve();}catch(error){reject(error);}});
      socket.connect(endpoint,()=>{socket.destroy();reject(Error('Closed IPC endpoint connected'));});
    });
    for(const outside of [path.join(tmpdir(),'absent-parent',path.basename(endpoint)),path.join('/',path.basename(endpoint))])
      assert.throws(()=>new Socket().connect(outside),/Offline regression forbids network access/);
    // A genuine same-UID socket from another worker is not this process's
    // registered endpoint, even when its basename matches the component lease.
    const worker = new Worker(\`
      const {parentPort,workerData}=require('node:worker_threads');
      const server=require('node:net').createServer(socket=>socket.destroy());
      server.listen(workerData,()=>parentPort.postMessage('ready'));
      parentPort.once('message',()=>server.close(()=>parentPort.postMessage('closed')));
    \`,{eval:true,execArgv:[],workerData:endpoint});
    try {
      await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
      assert.throws(()=>new Socket().connect(endpoint),/Offline regression forbids network access/);
      const closed = new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
      worker.postMessage('close');
      await closed;
    } finally {await worker.terminate();await rm(endpoint,{force:true});}
  }
}
console.log('Offline network guard verified; external transports/redirects and unowned endpoints blocked.');
`,
  ],
  { cwd: workspace.platformRoot, stdio: 'inherit', env },
);
if (await wait(preflight)) throw Error('Offline guard preflight failed');
console.log(
  full
    ? 'Full offline unit/renderer matrix: loopback, exact self listeners and component IPC only; external transport blocked.'
    : 'Offline interview regression: all network transports blocked; synthetic input/provider; temporary files cleaned at exit.',
);
const child = spawnTestProcess(
  process.execPath,
  [
    path.join(path.dirname(workspace.platformRequire.resolve('vitest/package.json')), 'vitest.mjs'),
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

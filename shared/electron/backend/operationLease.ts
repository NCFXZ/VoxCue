import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

type Operation = 'component' | 'account-export' | 'account-export-stage';
export const validLeaseToken = (token: unknown): token is string =>
  typeof token === 'string' && /^[a-f0-9]{32}$/.test(token);

function endpoint(operation: Operation, token: string) {
  if (!validLeaseToken(token)) throw Error('Invalid operation lease');
  const prefixes: Record<Operation, string> = { component: 'vcc-', 'account-export': 'vce-', 'account-export-stage': 'vcs-' };
  if (!Object.hasOwn(prefixes, operation)) throw Error('Invalid operation');
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\voxcue-' + operation + '-' + token
    : path.join(tmpdir(), prefixes[operation] + token);
}

// The OS owns this listener for exactly this operation's lifetime. A recycled
// PID cannot keep an abandoned operation alive, and wall-clock changes do not
// affect ownership. No marker-supplied path or network address is accepted.
export async function holdOperationLease(operation: Operation, token: string) {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint(operation, token), () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.on('error', () => {});
  server.unref();
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

export function operationLeaseAbsent(operation: Operation, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(endpoint(operation, token));
    const finish = (absent: boolean) => {
      socket.destroy();
      resolve(absent);
    };
    socket.once('connect', () => finish(false));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish(error.code === 'ENOENT' || error.code === 'ECONNREFUSED'),
    );
    // Permission failures, timeouts and unrecognized errors protect the stage.
    socket.setTimeout(500, () => finish(false));
  });
}

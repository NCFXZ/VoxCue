import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const validComponentLease = (token: unknown): token is string =>
  typeof token === 'string' && /^[a-f0-9]{32}$/.test(token);

function endpoint(token: string) {
  if (!validComponentLease(token)) throw Error('Invalid component lease');
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\voxcue-component-' + token
    : path.join(tmpdir(), 'vcc-' + token);
}

// The OS owns this listener for exactly this operation's lifetime. A recycled
// PID cannot keep an abandoned operation alive, and wall-clock changes do not
// affect ownership. No marker-supplied path or network address is accepted.
export async function holdComponentLease(token: string) {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint(token), () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.on('error', () => {});
  server.unref();
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

export function componentLeaseAbsent(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(endpoint(token));
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

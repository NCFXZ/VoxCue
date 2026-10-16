import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
const compiler = spawn(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'],
  { stdio: 'inherit' },
);
const code = await new Promise((resolve) => compiler.on('exit', resolve));
if (code !== 0) process.exit(code ?? 1);
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill());

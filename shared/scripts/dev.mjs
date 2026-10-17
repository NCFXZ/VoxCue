import workspace from './workspace.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { createServer } = workspace.platformRequire('vite');
const electron = workspace.platformRequire('electron');
const compiler = spawn(
  process.execPath,
  [fileURLToPath(new URL('./build-electron.mjs', import.meta.url))],
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

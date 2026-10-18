import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const moduleUrl = pathToFileURL(path.resolve('../shared/test/scripts/test-workspace.mjs')).href;
function launch(tail: string) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {testRoot} from ${JSON.stringify(moduleUrl)}; process.on('message', value => { if(value === 'SIGTERM') process.emit('SIGTERM'); }); process.channel?.unref(); console.log(JSON.stringify({root:testRoot})); ${tail}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  let output = '';
  const first = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (data) => {
      output += data;
      if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0]).root);
    });
    child.once('error', reject);
    child.once('exit', () => {
      if (!output) reject(Error('Test helper did not start'));
    });
  });
  return { child, first };
}
it('异常退出只清理当前临时测试工作区，报告不落盘', async () => {
  const { child, first } = launch('throw Error("synthetic test failure")');
  const exited = once(child, 'exit');
  const root = await first;
  expect((await exited)[0]).toBe(1);
  expect(existsSync(root)).toBe(false);
});
it('取消时清理临时目录并保留取消退出状态', async () => {
  const { child, first } = launch('setInterval(()=>{},1000)');
  const root = await first;
  const exited = once(child, 'exit');
  // Windows TerminateProcess is uncatchable. Test cooperative cancellation;
  // the next case separately verifies recovery after forced termination.
  if (process.platform === 'win32') child.send('SIGTERM');
  else child.kill('SIGTERM');
  expect((await exited)[0]).toBe(143);
  expect(existsSync(root)).toBe(false);
});
it('不可捕获中断留下的自有目录在下次运行前清理', async () => {
  const first = launch('setInterval(()=>{},1000)');
  const root = await first.first;
  const killed = once(first.child, 'exit');
  first.child.kill('SIGKILL');
  await killed;
  expect(existsSync(root)).toBe(true);
  const second = launch('');
  const exited = once(second.child, 'exit');
  const next = await second.first;
  expect((await exited)[0]).toBe(0);
  expect(existsSync(root)).toBe(false);
  expect(existsSync(next)).toBe(false);
});

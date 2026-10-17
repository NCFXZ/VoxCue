import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const host = process.platform === 'win32' ? 'windows' : 'macos';
const other = host === 'macos' ? 'windows' : 'macos';

it.each(['sync-platform-manifests.mjs', 'format.mjs', 'build-electron.mjs'])(
  '%s 在另一平台目录内启动时必须在写入前拒绝',
  (name) => {
    const result = spawnSync(process.execPath, [path.join(root, 'shared/scripts', name)], {
      cwd: path.join(root, other),
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('is read-only');
  },
);
it('格式化目标只有共享源码和本平台，不包含另一平台', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'shared/scripts/format.mjs'), '--list'],
    {
      cwd: path.join(root, host),
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  expect(result.status).toBe(0);
  const value = JSON.parse(result.stdout);
  expect(value.platform).toBe(host);
  expect(value.targets.some((target: string) => target.startsWith(`../${host}/`))).toBe(true);
  expect(value.targets.every((target: string) => !target.includes(other))).toBe(true);
});

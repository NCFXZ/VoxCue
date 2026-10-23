import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

// Screenshot delivery is opt-in. Ordinary regressions keep their zero-output policy.
export async function captureRequested(target, name) {
  const directory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
  if (!directory) return;
  assert.ok(path.isAbsolute(directory), 'Screenshot delivery requires an absolute directory');
  const root = path.resolve(directory);
  const file = path.resolve(root, name + '.png');
  assert.ok(file.startsWith(root + path.sep), 'Screenshot must stay inside the delivery directory');
  await mkdir(path.dirname(file), { recursive: true });
  await target.screenshot({ path: file, animations: 'disabled', scale: 'css' });
}

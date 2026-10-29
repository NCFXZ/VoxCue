import * as fs from 'node:fs/promises';
import path from 'node:path';

export const accountErasureMarker = 'account-erasure.pending';
// Public models, update state, fixed host identity and application resources are deliberately absent.
export const personalDataPaths = [
  'cloud-account',
  'knowledge-v1',
  'interview-images-v1',
  'chat-usage',
  'chatgpt-usage',
  'telemetry-queue.json',
  'copilot-runtime',
  'auth-data/credentials.bin',
  'auth-data/copilot-session.json',
  'auth-data/service.json',
] as const;
/** Call only after every consumer and renderer has stopped. Never follows a redirected target. */
export async function eraseLocalAccount(root: string, clearBrowser: () => Promise<void>) {
  const realRoot = await fs.realpath(root);
  const targets: string[] = [];
  for (const relative of personalDataPaths) {
    const target = path.join(realRoot, relative);
    try {
      const actual = await fs.realpath(target);
      if (actual !== target || (await fs.lstat(target)).isSymbolicLink())
        throw Error('账号资料路径已重定向，清理已停止。');
      const parent = await fs.realpath(path.dirname(target));
      if (parent !== path.dirname(target)) throw Error('账号资料父目录已重定向。');
      targets.push(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await clearBrowser();
  for (const target of targets) await fs.rm(target, { recursive: true, force: true });
  await fs.rm(path.join(realRoot, accountErasureMarker), { force: true });
}

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { profileDirectoryName } from '../accountProfilePaths';

export const accountErasureMarker = 'account-erasure.pending';
// Public models, update state, fixed host identity and application resources are deliberately absent.
export const personalDataPaths = [
  'cloud-account',
  'knowledge-v1',
  'interview-images-v1',
  'interview-recordings-v1',
  'chat-usage',
  'chatgpt-usage',
  'telemetry-queue.json',
  'copilot-runtime',
  'auth-data/credentials.bin',
  'auth-data/copilot-session.json',
  'auth-data/service.json',
  // Remove the retired connection marker only on an explicit account erasure.
  'auth-data/service-chatgpt-plan.json',
] as const;
/** Call only after every consumer and renderer has stopped. Never follows a redirected target. */
export async function eraseLocalAccount(root: string, clearBrowser: () => Promise<void>, owner?: string,
  options: { sharedSession?: boolean; legacyMarker?: boolean } = {}) {
  const realRoot = await fs.realpath(root);
  const targets: string[] = [];
  // Owner-less markers are written exclusively by the previous, single-profile build.
  const paths = owner === undefined ? personalDataPaths : [
    path.join('account-profiles', profileDirectoryName(owner)),
    path.join('interview-recordings-v1', profileDirectoryName(owner)),
    ...(options.sharedSession === false ? [] : ['telemetry-queue.json', 'cloud-account']),
  ];
  for (const relative of paths) {
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
  if (options.legacyMarker !== false) await fs.rm(path.join(realRoot, accountErasureMarker), { force: true });
}

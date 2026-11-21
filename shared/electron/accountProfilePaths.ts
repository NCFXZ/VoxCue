import { createHash } from 'node:crypto';
import path from 'node:path';

export const isCloudProfileOwner = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 44 &&
  /^account:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

export function profileDirectoryName(owner: string) {
  if (!['local', 'demo'].includes(owner) && !isCloudProfileOwner(owner))
    throw Error('账号资料归属无效。');
  return createHash('sha256').update(owner).digest('hex');
}

export function profileDirectory(root: string, owner: string) {
  return path.join(root, 'account-profiles', profileDirectoryName(owner));
}

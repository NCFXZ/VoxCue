import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import type { ComponentPackage } from './catalog';

interface Entry {
  entryName: string;
  isDirectory: boolean;
  attr: number;
  header: { size: number; flags: number };
  getData(): Buffer;
}
const Zip: new (data: Buffer) => { getEntries(): Entry[] } = require('adm-zip');
export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Authenticated archives still obey a closed file set and never extract through ZIP paths. */
export async function unpackComponent(
  bytes: Buffer,
  pkg: ComponentPackage,
  destination: string,
  signal: AbortSignal,
) {
  if (bytes.length !== pkg.bytes || sha256(bytes) !== pkg.sha256)
    throw Error('组件下载校验失败，请重试。');
  const entries = new Zip(bytes).getEntries();
  const expected = new Map(pkg.files.map((file) => [file.path, file]));
  if (entries.length !== expected.size) throw Error('组件归档文件列表不匹配。');
  const seen = new Set<string>();
  for (const entry of entries) {
    signal.throwIfAborted();
    const file = expected.get(entry.entryName);
    const type = (entry.attr >>> 16) & 0o170000;
    if (
      !file ||
      seen.has(file.path) ||
      entry.isDirectory ||
      (type !== 0 && type !== 0o100000) ||
      entry.header.flags & 1 ||
      entry.header.size !== file.bytes ||
      !safePath(file.path)
    )
      throw Error('组件归档包含无效文件。');
    seen.add(file.path);
    const data = entry.getData();
    if (data.length !== file.bytes || sha256(data) !== file.sha256)
      throw Error('组件文件校验失败，请重试。');
    const target = path.join(destination, ...file.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const handle = await open(target, 'wx', file.mode);
    try {
      await handle.writeFile(data);
      await handle.chmod(file.mode);
    } finally {
      await handle.close();
    }
  }
}

export function safePath(value: string) {
  return (
    value.length > 0 &&
    !value.includes('\\') &&
    !value.includes(':') &&
    !value.includes('\0') &&
    value.split('/').every((part) => !!part && part !== '.' && part !== '..')
  );
}

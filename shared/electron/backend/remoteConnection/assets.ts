import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface MobileAssets {
  read(pathname: string): Promise<{ contentType: string; body: Buffer } | null>;
}

const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const MAX_INDEX = 256 * 1024;
const mime: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};
const assetName = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(value) &&
  !!mime[path.posix.extname(value)];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Only the built mobile entry's manifest dependency closure is public. */
export function createMobileAssets(directory: string): MobileAssets {
  let loaded: Promise<{ root: string; files: Set<string>; html: Buffer }> | undefined;
  const contained = async (root: string, relative: string) => {
    const target = await realpath(path.join(root, relative));
    const difference = path.relative(root, target);
    if (!difference || difference.startsWith('..') || path.isAbsolute(difference))
      throw Error('Invalid mobile asset');
    return target;
  };
  const boundedRead = async (target: string, maximum: number) => {
    const info = await stat(target);
    if (!info.isFile() || info.size > maximum) throw Error('Invalid mobile asset size');
    const body = await readFile(target);
    if (body.length > maximum) throw Error('Invalid mobile asset size');
    return body;
  };
  const load = async () => {
    const root = await realpath(directory);
    const manifestBytes = await boundedRead(
      await contained(root, '.vite/manifest.json'),
      MAX_INDEX,
    );
    const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'));
    if (!object(manifest) || !Object.hasOwn(manifest, 'mobile.html'))
      throw Error('Mobile entry missing');
    const otherEntries = new Set(
      Object.entries(manifest).flatMap(([key, value]) =>
        key !== 'mobile.html' &&
        object(value) &&
        value.isEntry === true &&
        typeof value.file === 'string'
          ? [value.file]
          : [],
      ),
    );
    const files = new Set<string>();
    const visited = new Set<string>();
    const add = (name: unknown) => {
      if (!assetName(name) || otherEntries.has(name)) throw Error('Invalid mobile asset name');
      files.add(name);
      if (files.size > 256) throw Error('Too many mobile assets');
    };
    const visit = (key: unknown) => {
      if (typeof key !== 'string' || key.length > 256 || !Object.hasOwn(manifest, key))
        throw Error('Mobile dependency missing');
      if (visited.has(key)) return;
      visited.add(key);
      if (visited.size > 128) throw Error('Too many mobile dependencies');
      const chunk = manifest[key];
      if (
        !object(chunk) ||
        typeof chunk.file !== 'string' ||
        !chunk.file.endsWith('.js') ||
        (key === 'mobile.html' ? chunk.isEntry !== true : chunk.isEntry === true)
      )
        throw Error('Invalid mobile entry');
      add(chunk.file);
      for (const field of ['css', 'assets'] as const) {
        if (chunk[field] === undefined) continue;
        if (!Array.isArray(chunk[field])) throw Error('Invalid mobile dependencies');
        chunk[field].forEach(add);
      }
      for (const field of ['imports', 'dynamicImports'] as const) {
        if (chunk[field] === undefined) continue;
        if (!Array.isArray(chunk[field])) throw Error('Invalid mobile imports');
        chunk[field].forEach(visit);
      }
    };
    visit('mobile.html');
    const html = await boundedRead(await contained(root, 'mobile.html'), MAX_INDEX);
    const text = html.toString('utf8');
    if (/<style\b|\b(?:style|on[a-z]+)\s*=/i.test(text))
      throw Error('Inline mobile code is forbidden');
    for (const script of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (!/\bsrc\s*=\s*["'][^"']+["']/i.test(script[1]) || script[2].trim())
        throw Error('Inline mobile script is forbidden');
    }
    for (const reference of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const name = reference[1].replace(/^\.\//, '');
      if (!files.has(name)) throw Error('Mobile HTML references an unlisted asset');
    }
    let total = html.length + manifestBytes.length;
    for (const name of files) {
      const info = await stat(await contained(root, name));
      if (!info.isFile() || info.size > MAX_FILE) throw Error('Invalid mobile asset size');
      total += info.size;
      if (total > MAX_TOTAL) throw Error('Mobile assets exceed limit');
    }
    return { root, files, html };
  };
  return {
    async read(pathname) {
      if (pathname !== '/' && (!pathname.startsWith('/') || !assetName(pathname.slice(1))))
        return null;
      loaded ??= load().catch((error) => {
        loaded = undefined;
        throw error;
      });
      const assets = await loaded;
      if (pathname === '/') return { contentType: 'text/html; charset=utf-8', body: assets.html };
      const name = pathname.slice(1);
      if (!assets.files.has(name)) return null;
      return {
        contentType: mime[path.posix.extname(name)],
        body: await boundedRead(await contained(assets.root, name), MAX_FILE),
      };
    },
  };
}

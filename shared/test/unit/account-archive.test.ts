import { it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { AccountArchive } from '../../electron/backend/accountArchive';
import {
  eraseLocalAccount,
  accountErasureMarker,
  personalDataPaths,
} from '../../electron/backend/accountErasure';

it('exports exactly three root folders, text, nested record screenshots and unchanged original bytes; native cancel is inert', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-account-test-'));
  const data = path.join(root, 'profile');
  await fs.mkdir(data);
  const zip = path.join(root, '自选保存位置.zip');
  const image = Buffer.from('synthetic image');
  let destination: string | undefined;
  const archive = new AccountArchive({
    userData: data,
    choose: async () => destination,
    image: async () => ({ bytes: image, extension: 'png' }),
  });
  try {
    expect(await archive.call('owner', { action: 'begin', files: 3 })).toEqual({
      ok: true,
      canceled: true,
    });
    expect(await fs.readdir(root)).toEqual(['profile']);
    destination = zip;
    const begin = await archive.call('owner', { action: 'begin', files: 3 });
    expect(begin.ok).toBe(true);
    const token = (begin as { token: string }).token;
    const send = async (call: any) =>
      expect(await archive.call('owner', { token, ...call })).toEqual({ ok: true });
    await send({ action: 'base', baseId: 'empty', baseName: '空知识库' });
    for (const [kind, name, bytes, extra] of [
      ['personal', 'ignored.txt', Buffer.from('姓名\n合成用户'), {}],
      [
        'record',
        '面试.txt',
        Buffer.from('面试官：合成问题\n面试者：合成转录'),
        { images: ['11111111-1111-4111-8111-111111111111'] },
      ],
      [
        'document',
        '../原件.txt',
        Buffer.from([0, 255, 1, 2]),
        { baseId: 'base', baseName: '../合成库' },
      ],
    ] as const) {
      await send({ action: 'file', kind, name, size: bytes.length, ...extra });
      await send({ action: 'chunk', bytes: new Uint8Array(bytes) });
      await send({ action: 'end' });
    }
    expect(await archive.call('owner', { action: 'finish', token })).toEqual({
      ok: true,
      saved: true,
    });
    const z = new AdmZip(zip);
    expect([...new Set(z.getEntries().map((e) => e.entryName.split('/')[0]))].sort()).toEqual(
      ['个人信息', '知识库', '面试记录'].sort(),
    );
    expect(z.readAsText('个人信息/个人信息.txt')).toBe('姓名\n合成用户');
    expect(z.readAsText('面试记录/面试.txt')).toContain('合成转录');
    const screenshots = new AdmZip(z.readFile('面试记录/面试-截图.zip')!);
    expect(screenshots.readFile('1.png')).toEqual(image);
    const original = z.getEntries().find((e) => e.entryName.endsWith('.._原件.txt'))!;
    expect(original.getData()).toEqual(Buffer.from([0, 255, 1, 2]));
    expect(z.getEntries().some((e) => e.entryName.startsWith('知识库/空知识库-'))).toBe(true);
    expect(z.getEntries().every((e) => !e.entryName.split('/').includes('..'))).toBe(true);
    expect(await fs.readdir(root)).toEqual(expect.arrayContaining(['profile', '自选保存位置.zip']));
  } finally {
    await archive.cancel();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);

it('rejects overflow, unfinished exports, foreign tokens and internal save paths without replacing a user file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-account-test-'));
  await fs.mkdir(path.join(root, 'profile'));
  const zip = path.join(root, 'existing.zip');
  await fs.writeFile(zip, 'preserve');
  let destination = zip;
  const a = new AccountArchive({
    userData: path.join(root, 'profile'),
    choose: async () => destination,
    image: async () => {
      throw Error('missing');
    },
  });
  try {
    let r = await a.call('owner', { action: 'begin', files: 1 });
    const token = (r as { token: string }).token;
    expect((await a.call('other', { action: 'cancel', token })).ok).toBe(false);
    expect(
      (await a.call('owner', { action: 'file', token, kind: 'personal', name: 'x', size: 1 })).ok,
    ).toBe(true);
    expect((await a.call('owner', { action: 'chunk', token, bytes: new Uint8Array(2) })).ok).toBe(
      false,
    );
    expect(await fs.readFile(zip, 'utf8')).toBe('preserve');
    r = await a.call('owner', { action: 'begin', files: 1 });
    expect(
      (await a.call('owner', { action: 'finish', token: (r as { token: string }).token })).ok,
    ).toBe(false);
    destination = path.join(root, 'profile', 'bad.zip');
    expect((await a.call('owner', { action: 'begin', files: 1 })).ok).toBe(false);
    expect(await fs.readFile(zip, 'utf8')).toBe('preserve');
  } finally {
    await a.cancel();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('clears only personal stores after browser shutdown, preserves model binaries and fixed identity, and retries idempotently', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-erasure-test-'));
  try {
    for (const relative of personalDataPaths) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (relative.includes('.bin') || relative.includes('.json'))
        await fs.writeFile(target, 'synthetic');
      else {
        await fs.mkdir(target);
        await fs.writeFile(path.join(target, 'synthetic'), 'data');
      }
    }
    await fs.mkdir(path.join(root, 'component-cache'));
    await fs.writeFile(path.join(root, 'component-cache', 'public-model'), 'keep');
    await fs.writeFile(path.join(root, 'auth-data', 'host-id'), 'fixed');
    await fs.writeFile(path.join(root, accountErasureMarker), '{}');
    let cleared = false;
    await eraseLocalAccount(root, async () => {
      expect(await fs.readFile(path.join(root, 'interview-images-v1', 'synthetic'), 'utf8')).toBe(
        'data',
      );
      cleared = true;
    });
    expect(cleared).toBe(true);
    expect(await fs.readFile(path.join(root, 'component-cache', 'public-model'), 'utf8')).toBe(
      'keep',
    );
    expect(await fs.readFile(path.join(root, 'auth-data', 'host-id'), 'utf8')).toBe('fixed');
    for (const relative of personalDataPaths)
      await expect(fs.stat(path.join(root, relative))).rejects.toMatchObject({ code: 'ENOENT' });
    await eraseLocalAccount(root, async () => {});
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

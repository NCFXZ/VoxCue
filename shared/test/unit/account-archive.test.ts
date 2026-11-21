import { it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import { copyAccountExport, recoverExportOutputs } from '../../electron/backend/accountExportOutput';
import { holdOperationLease, operationLeaseAbsent } from '../../electron/backend/operationLease';
import { AccountArchive, recoverAccountExports, zipDirectory } from '../../electron/backend/accountArchive';
import { temporaryDirectory } from '../temp';

it('publishes cross-volume output and recovers only an identified abandoned copy', async () => {
  const root = await temporaryDirectory('archive-output');
  const userData = path.join(root, 'profile');
  await fs.mkdir(userData);
  const source = path.join(root, 'source.zip'), destination = path.join(root, 'export.zip');
  await fs.writeFile(source, 'synthetic complete ZIP');
  await fs.writeFile(destination, 'previous export');
  await copyAccountExport(source, destination, userData, new AbortController().signal);
  expect(await fs.readFile(destination, 'utf8')).toBe('synthetic complete ZIP');
  const directory = path.join(userData, 'pending-account-exports');
  expect(await fs.readdir(directory)).toEqual([]);
  for (const replace of [false, true]) {
    const id = randomUUID(), file = path.join(root, '.voxcue-export-' + id + '.tmp');
    await fs.writeFile(file, 'synthetic partial ZIP');
    const stat = await fs.stat(file, { bigint: true });
    const identity = {
      parent: await fs.realpath(root), dev: String(stat.dev), ino: String(stat.ino), birth: String(stat.birthtimeNs),
    };
    await fs.writeFile(path.join(directory, id), JSON.stringify({ ...identity, pid: process.pid }));
    await recoverExportOutputs(userData);
    expect(await fs.readFile(file, 'utf8')).toBe('synthetic partial ZIP');
    await fs.writeFile(path.join(directory, id), JSON.stringify({ ...identity, pid: 0x7fffffff }));
    if (replace) {
      await fs.rename(file, file + '.original');
      await fs.writeFile(file, 'another file');
    }
    await recoverExportOutputs(userData);
    if (replace) expect(await fs.readFile(file, 'utf8')).toBe('another file');
    else await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  expect(await fs.readFile(destination, 'utf8')).toBe('synthetic complete ZIP');
});

it('uses the local export operation lease when a crashed writer PID has been reused', async () => {
  const root = await temporaryDirectory('archive-lease');
  const folder = path.join(root, 'pending-account-exports');
  await fs.mkdir(folder);
  const id = randomUUID(), token = id.replaceAll('-', '');
  const file = path.join(root, '.voxcue-export-' + id + '.tmp');
  await fs.writeFile(file, 'synthetic partial export');
  const stat = await fs.stat(file, { bigint: true });
  await fs.writeFile(path.join(folder, id), JSON.stringify({
    version: 2, pid: process.pid, parent: await fs.realpath(root),
    dev: String(stat.dev), ino: String(stat.ino), birth: String(stat.birthtimeNs),
  }));
  const closeComponent = await holdOperationLease('component', token);
  try {
    const closeExport = await holdOperationLease('account-export', token);
    try {
      await recoverExportOutputs(root);
      expect(await fs.readFile(file, 'utf8')).toBe('synthetic partial export');
    } finally { await closeExport(); }
    await recoverExportOutputs(root);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(folder)).toEqual([]);
  } finally { await closeComponent(); }
});

it('cancelling during the first screenshot read stops the remaining batch before any ZIP starts', async () => {
  const root = await temporaryDirectory('cancel-export-images'), userData = path.join(root, 'profile');
  await fs.mkdir(userData);
  const initialFiles = await fs.readdir(root);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let reads = 0, zips = 0;
  const archive = new AccountArchive({
    userData, choose: async () => path.join(root, 'export.zip'),
    image: async () => { reads++; entered.resolve(); await release.promise; return { bytes: Buffer.from('image'), extension: 'png' }; },
    zip: async () => { zips++; },
  });
  try {
    const start = await archive.call('local', { action: 'begin', files: 1 });
    if (!start.ok || !start.token) throw Error('fixture failed');
    const call = archive.call('local', { action: 'file', token: start.token, size: 0, kind: 'record', name: 'record.txt',
      images: Array.from({ length: 12 }, () => randomUUID()) });
    await entered.promise;
    const cancel = archive.cancel();
    release.resolve();
    expect((await call).ok).toBe(false);
    await cancel;
    expect([reads, zips]).toEqual([1, 0]);
    expect(await fs.readdir(root)).toEqual(initialFiles);
  } finally { release.resolve(); await archive.dispose(); }
});

it('holds the source-stage lease until cleanup and keeps it separate from output publication', async () => {
  const root = await temporaryDirectory('stage-lease');
  const userData = path.join(root, 'profile'), destination = path.join(root, 'export.zip');
  await fs.mkdir(userData);
  let stage = '', token = '';
  const archive = new AccountArchive({
    userData, choose: async () => destination, image: async () => { throw Error('unexpected image'); },
    zip: async (source, output) => {
      stage = path.dirname(source);
      const owner = JSON.parse(await fs.readFile(path.join(stage, '.owner'), 'utf8'));
      token = owner.token;
      expect(owner).toEqual({ kind: 'voxcue-account-export', version: 2, stage: 'voxcue-account-export-' + token, token });
      expect(await operationLeaseAbsent('account-export-stage', token)).toBe(false);
      expect(await operationLeaseAbsent('account-export', token)).toBe(true);
      await fs.writeFile(output, 'complete synthetic export');
    },
  });
  try {
    const result = await archive.call('local', { action: 'begin', files: 1 });
    if (!result.ok || !result.token) throw Error('fixture failed');
    expect((await archive.call('local', { action: 'file', token: result.token, kind: 'personal', size: 0, name: 'personal.txt' })).ok).toBe(true);
    expect((await archive.call('local', { action: 'end', token: result.token })).ok).toBe(true);
    expect((await archive.call('local', { action: 'finish', token: result.token })).ok).toBe(true);
    await expect(fs.lstat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await operationLeaseAbsent('account-export-stage', token)).toBe(true);
  } finally { await archive.dispose(); }
});
it('cleans only inactive recognized stage leases and preserves unrelated or mismatched markers', async () => {
  const root = await temporaryDirectory('separate-stage-owners');
  const token = () => randomUUID().replaceAll('-', '');
  const ids = { active: token(), abandoned: token(), mismatch: token(), unknown: token(), extra: token() };
  const stage = (id: string) => 'voxcue-account-export-' + id;
  for (const id of Object.values(ids)) {
    const dir = path.join(root, stage(id));
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, '.owner'), JSON.stringify({ kind: 'voxcue-account-export', version: 2,
      stage: stage(id), token: id === ids.mismatch ? token() : id, ...(id === ids.extra ? { pid: process.pid } : {}) }));
    await fs.writeFile(path.join(dir, id === ids.unknown ? 'unknown-entry' : '资料.zip'), 'synthetic');
  }
  const close = await holdOperationLease('account-export-stage', ids.active);
  const other = await holdOperationLease('account-export', ids.abandoned);
  try {
    await recoverAccountExports(root);
    await expect(fs.lstat(path.join(root, stage(ids.abandoned)))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const id of [ids.active, ids.mismatch, ids.unknown, ids.extra])
      expect((await fs.lstat(path.join(root, stage(id)))).isDirectory()).toBe(true);
  } finally { await close(); await other(); }
  await recoverAccountExports(root);
  await expect(fs.lstat(path.join(root, stage(ids.active)))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('recovers only abandoned owned export stages, including legacy PID markers', async () => {
  const root = await temporaryDirectory('archive-recovery');
  for (const [suffix, pid] of [['old001', 0x7fffffff], ['new001', 0x7fffffff], ['live01', process.pid], ['other1', 0]] as const) {
    const stage = 'voxcue-account-export-' + suffix;
    await fs.mkdir(path.join(root, stage, 'data'), { recursive: true });
    await fs.writeFile(path.join(root, stage, '资料.zip'), 'synthetic partial archive');
    await fs.writeFile(path.join(root, stage, '.owner'), JSON.stringify(
      suffix === 'old001' ? pid : { kind: 'voxcue-account-export', stage, pid },
    ));
  }
  await recoverAccountExports(root);
  expect((await fs.readdir(root)).filter(n => n.startsWith('voxcue-')).sort())
    .toEqual(['voxcue-account-export-live01', 'voxcue-account-export-other1']);
});
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
    const movedImage = Uint8Array.from([255, 216, 255, 1]);
    const movedImageId = '22222222-2222-4222-8222-222222222222';
    await send({ action: 'stageImage', id: movedImageId, bytes: movedImage });
    for (const [kind, name, bytes, extra] of [
      ['personal', 'ignored.txt', Buffer.from('姓名\n合成用户'), {}],
      [
        'record',
        '面试.txt',
        Buffer.from('面试官：合成问题\n面试者：合成转录'),
        { images: ['11111111-1111-4111-8111-111111111111', movedImageId] },
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
    expect(screenshots.readFile('2.jpg')).toEqual(Buffer.from(movedImage));
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

it('cancels an in-flight screenshot export before cleanup and rejects late dialog results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-account-test-'));
  await fs.mkdir(path.join(root, 'profile'));
  const zip = path.join(root, 'existing.zip');
  await fs.writeFile(zip, 'preserve');
  let choose!: (value: string) => void;
  let image!: () => void;
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const a = new AccountArchive({
    userData: path.join(root, 'profile'),
    choose: () =>
      new Promise((resolve) => {
        choose = resolve;
      }),
    image: async () => {
      entered();
      await new Promise<void>((resolve) => {
        image = resolve;
      });
      return { bytes: Buffer.from('synthetic'), extension: 'png' };
    },
  });
  try {
    const begin = a.call('owner', { action: 'begin', files: 1 });
    const cancelled = a.cancel();
    choose(zip);
    expect((await begin).ok).toBe(false);
    await cancelled;
    expect(a.hasWork()).toBe(false);
    const next = a.call('owner', { action: 'begin', files: 1 });
    choose(zip);
    const token = ((await next) as { token: string }).token;
    const file = a.call('owner', {
      action: 'file',
      token,
      kind: 'record',
      name: 'record.txt',
      size: 1,
      images: ['11111111-1111-4111-8111-111111111111'],
    });
    await reading;
    const stopped = a.cancel();
    expect(a.hasWork()).toBe(true);
    expect((await a.call('owner', { action: 'begin', files: 1 })).ok).toBe(false);
    image();
    expect((await file).ok).toBe(false);
    await stopped;
    expect(a.hasWork()).toBe(false);
    expect((await a.call('owner', { action: 'finish', token })).ok).toBe(false);
    expect(await fs.readFile(zip, 'utf8')).toBe('preserve');
  } finally {
    await a.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('never replaces an existing destination when cancellation arrives during ZIP creation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-account-test-'));
  await fs.mkdir(path.join(root, 'profile'));
  const destination = path.join(root, 'existing.zip');
  await fs.writeFile(destination, 'preserve');
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const compressed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const a = new AccountArchive({
    userData: path.join(root, 'profile'),
    choose: async () => destination,
    image: async () => {
      throw Error('Unexpected screenshot');
    },
    zip: async (source, output) => {
      await zipDirectory(source, output);
      entered();
      await held;
    },
  });
  try {
    const { token } = (await a.call('owner', { action: 'begin', files: 1 })) as { token: string };
    expect(
      await a.call('owner', { action: 'file', token, kind: 'personal', name: 'x', size: 0 }),
    ).toEqual({ ok: true });
    expect(await a.call('owner', { action: 'end', token })).toEqual({ ok: true });
    const finish = a.call('owner', { action: 'finish', token });
    await compressed;
    const cancelled = a.cancel();
    expect(await fs.readFile(destination, 'utf8')).toBe('preserve');
    release();
    expect((await finish).ok).toBe(false);
    await cancelled;
    expect(a.hasWork()).toBe(false);
    expect(await fs.readFile(destination, 'utf8')).toBe('preserve');
  } finally {
    release();
    await a.dispose();
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
    await fs.writeFile(
      path.join(root, 'telemetry-installation.json'),
      '{"installationId":"public-random-id"}',
    );
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
    expect(await fs.readFile(path.join(root, 'telemetry-installation.json'), 'utf8')).toContain(
      'public-random-id',
    );
    for (const relative of personalDataPaths)
      await expect(fs.stat(path.join(root, relative))).rejects.toMatchObject({ code: 'ENOENT' });
    await eraseLocalAccount(root, async () => {});
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

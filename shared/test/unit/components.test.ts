import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  ComponentService,
  componentLocation,
  componentPaths,
} from '../../../shared/electron/backend/components/service';
import { unpackComponent } from '../../../shared/electron/backend/components/archive';
import {
  packagesFor,
  type ComponentPackage,
} from '../../../shared/electron/backend/components/catalog';
const Zip = require('adm-zip');
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-component-unit-'));
  temporary.push(root);
  const data = Buffer.from('fixed public fixture');
  const zip = new Zip();
  zip.addFile('speech/model.onnx', data);
  const bytes: Buffer = zip.toBuffer();
  const pkg: ComponentPackage = {
    id: 'speech',
    target: 'all',
    label: '本地语音模型',
    version: '1.0.0',
    tag: 'models-v1.0.0',
    asset: 'fixture.zip',
    bytes: bytes.length,
    sha256: digest(bytes),
    directory: 'speech',
    files: [{ path: 'speech/model.onnx', bytes: data.length, sha256: digest(data), mode: 0o644 }],
  };
  const fetcher = vi.fn(async () => new Response(new Uint8Array(bytes)));
  const service = () =>
    new ComponentService({
      root,
      packages: [pkg],
      managed: true,
      fetch: fetcher as typeof fetch,
      emit: vi.fn(),
    });
  return { root, pkg, bytes, data, fetcher, service };
}
describe('独立组件下载与版本缓存', () => {
  it('不在状态检查时联网；按组件下载、完整校验，重启及应用升级后离线复用', async () => {
    const f = await fixture(),
      service = f.service();
    expect((await service.status()).phase).toBe('needed');
    expect(f.fetcher).not.toHaveBeenCalled();
    expect((await service.download('speech')).phase).toBe('ready');
    expect(f.fetcher).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/NCFXZ/VoxCue-releases/releases/download/models-v1.0.0/fixture.zip',
      expect.objectContaining({ credentials: 'omit' }),
    );
    f.fetcher.mockImplementation(async () => {
      throw Error('offline');
    });
    const restarted = f.service();
    expect((await restarted.status()).phase).toBe('ready');
    await restarted.download('speech');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(componentLocation(f.root, f.pkg)).not.toContain('0.2.1');
  });
  it('损坏、缺失和多余文件均不视为就绪；重试修复已拥有的缓存', async () => {
    const f = await fixture();
    await f.service().download();
    const file = path.join(componentLocation(f.root, f.pkg), 'files/speech/model.onnx');
    await writeFile(file, Buffer.alloc(f.data.length));
    const repair = f.service();
    expect((await repair.status()).phase).toBe('needed');
    expect((await repair.download()).phase).toBe('ready');
    expect(await readFile(file)).toEqual(f.data);
    await writeFile(path.join(path.dirname(file), 'unexpected.js'), 'untrusted');
    expect((await f.service().status()).phase).toBe('needed');
    await rm(file);
    expect((await f.service().status()).phase).toBe('needed');
  });
  it('网络失败和摘要不匹配不会发布半成品，重试只下载缺失组件', async () => {
    const f = await fixture();
    f.fetcher.mockImplementationOnce(
      async () => new Response(new Uint8Array(Buffer.alloc(f.bytes.length))),
    );
    const service = f.service();
    expect((await service.download()).phase).toBe('error');
    expect(await readdir(f.root)).toEqual([]);
    expect((await service.download()).phase).toBe('ready');
  });
  it('拒绝超长、截断及错误 Content-Length', async () => {
    for (const response of [
      new Response(new Uint8Array(Buffer.alloc(1))),
      new Response(new Uint8Array(Buffer.alloc(10000))),
      new Response('x', { headers: { 'content-length': '1' } }),
    ]) {
      const f = await fixture();
      f.fetcher.mockImplementationOnce(async () => response);
      expect((await f.service().download()).phase).toBe('error');
      expect(await readdir(f.root)).toEqual([]);
    }
  });
  it('取消会终止流并清理暂存，随后可重试', async () => {
    const f = await fixture();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    f.fetcher.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(f.bytes.subarray(0, 2)));
              started();
            },
          }),
        ),
    );
    const service = f.service(),
      download = service.download();
    await ready;
    await service.cancel();
    expect((await download).phase).toBe('cancelled');
    expect(await readdir(f.root)).toEqual([]);
    expect((await service.download()).phase).toBe('ready');
  });
  it('合并并发下载，已完成组件不会被其他组件的取消移除', async () => {
    const f = await fixture(),
      second = { ...f.pkg, id: 'rag' as const };
    const service = new ComponentService({
      root: f.root,
      packages: [f.pkg, second],
      managed: true,
      fetch: f.fetcher as typeof fetch,
      emit: vi.fn(),
    });
    const first = service.download('speech');
    expect(service.download('speech')).toBe(first);
    await first;
    expect(service.ready('speech')).toBe(true);
    expect(service.ready('rag')).toBe(false);
    await service.cancel();
    expect(service.ready('speech')).toBe(true);
    await service.download('rag');
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it('拒绝缓存根或文件链接，不改写链接目标', async () => {
    const f = await fixture();
    await f.service().download();
    const dir = componentLocation(f.root, f.pkg),
      file = path.join(dir, 'files/speech/model.onnx');
    const original = path.join(f.root, 'protected');
    await writeFile(original, 'original');
    await rm(file);
    await symlink(original, file);
    expect((await f.service().status()).phase).toBe('needed');
    expect(await readFile(original, 'utf8')).toBe('original');
  });
  it('认证归档仍拒绝路径穿越、额外文件和文件内容摘要不符', async () => {
    const f = await fixture();
    for (const mutate of [
      (p: ComponentPackage) => (p.files[0].sha256 = '0'.repeat(64)),
      (p: ComponentPackage) => (p.files[0].path = '../protected'),
    ]) {
      const pkg = structuredClone(f.pkg);
      mutate(pkg);
      await expect(
        unpackComponent(f.bytes, pkg, path.join(f.root, 'stage'), new AbortController().signal),
      ).rejects.toThrow();
    }
    const zip = new Zip(f.bytes);
    zip.addFile('extra.js', Buffer.from('untrusted'));
    const data = zip.toBuffer();
    await expect(
      unpackComponent(
        data,
        { ...f.pkg, bytes: data.length, sha256: digest(data) },
        path.join(f.root, 'stage'),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it('固定平台包和缓存入口，安装完整包及开发版保留原加载方式', async () => {
    expect(packagesFor('darwin', 'arm64').map((p) => p.id)).toEqual(['speech', 'rag']);
    expect(packagesFor('win32', 'x64').map((p) => p.id)).toEqual(['speech', 'rag']);
    expect(() => packagesFor('darwin', 'x64')).toThrow();
    const paths = componentPaths('/cache', packagesFor('darwin', 'arm64'));
    expect(paths.ragModel).toContain('multilingual-e5-small');
    const f = await fixture(),
      legacy = new ComponentService({
        root: f.root,
        packages: [f.pkg],
        managed: false,
        fetch: f.fetcher as typeof fetch,
        emit: vi.fn(),
      });
    expect((await legacy.download()).phase).toBe('ready');
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

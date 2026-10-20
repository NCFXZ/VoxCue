import { describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../temp';
import { createHash } from 'node:crypto';
import {
  ComponentService,
  componentLocation,
  componentPaths,
} from '../../../shared/electron/backend/components/service';
import {
  unpackComponent,
  unpackComponentFile,
} from '../../../shared/electron/backend/components/archive';
import {
  packagesFor,
  type ComponentPackage,
} from '../../../shared/electron/backend/components/catalog';
import { qwenPackage } from '../../electron/backend/components/qwen-catalog';
import { qwenInt8Aligner } from '../../electron/backend/components/qwen-int8-catalog';
import { qwenWindowsRuntime } from '../../electron/backend/components/qwen-windows-runtime-catalog';
const Zip = require('adm-zip');
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function fixture() {
  const root = path.join(await temporaryDirectory('components'), 'cache');
  await mkdir(root);
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
  it('Windows Q8_0升级保留原ASR和旧资源信任根，Mac不下载Windows运行时', () => {
    const windows = packagesFor('win32', 'x64').find((pkg) => pkg.id === 'qwen')!;
    const mac = packagesFor('darwin', 'arm64').find((pkg) => pkg.id === 'qwen')!;
    expect(windows.parts).toEqual([qwenPackage.parts![0], qwenInt8Aligner, qwenWindowsRuntime]);
    expect(mac.parts).toEqual([qwenPackage.parts![0], qwenInt8Aligner]);
    expect(windows.sha256).toBe('73e15188b94e7cd8684b7a33afbdb5e6b770bcd3ad6c8f441928c19231ea7987');
    expect(windows.files.find((file) => file.path === 'qwen/asr/model.safetensors')?.sha256).toBe(
      '79d6cbd4c98c7bbffe9db2edac07f56cd6637d0d5944b27f6c2b8353840323ea',
    );
    expect(qwenWindowsRuntime.sha256).toBe(
      'cf991cd03dd56c37647830ae2de3337b3ace7a5454c2595edd345b8f8468ca70',
    );
    expect(qwenWindowsRuntime.files).toHaveLength(400);
    for (const name of ['voxcue-qwen.exe', 'voxcue-qwen-cpu.exe'])
      expect(windows.files.some((file) => file.path === 'qwen/runtime/' + name)).toBe(true);
    expect(qwenPackage.version).toBe('1.0.0');
    expect(qwenPackage.parts!.at(-1)!.asset).toBe('VoxCue-Qwen-Windows-x64-Runtime-1.0.0.zip');
    expect(qwenPackage.files.some((file) => file.path === 'qwen/aligner/model.safetensors')).toBe(
      true,
    );
    expect(componentLocation('/cache', windows)).not.toBe(componentLocation('/cache', qwenPackage));
  });
  it('只安装Qwen也满足语音就绪，删除最后一个语音模型才变为缺失', async () => {
    const f = await fixture();
    const qwen = { ...f.pkg, id: 'qwen' as const, optional: true };
    const service = new ComponentService({
      root: f.root,
      packages: [f.pkg, qwen],
      managed: true,
      fetch: f.fetcher as typeof fetch,
      emit: vi.fn(),
    });
    expect((await service.download('qwen')).phase).toBe('ready');
    expect(service.ready('speech')).toBe(false);
    expect(service.ready('qwen')).toBe(true);
    expect((await service.remove('qwen')).phase).toBe('needed');
    expect(service.ready('qwen')).toBe(false);
    service.dispose();
  });
  it('默认下载只准备必需组件，Qwen 由用户单独选取下载', async () => {
    const f = await fixture();
    const qwen = { ...f.pkg, id: 'qwen' as const, optional: true };
    const service = new ComponentService({
      root: f.root,
      packages: [f.pkg, qwen],
      managed: true,
      fetch: f.fetcher as typeof fetch,
      emit: vi.fn(),
    });
    expect((await service.download()).phase).toBe('ready');
    expect(service.ready('speech')).toBe(true);
    expect(service.ready('qwen')).toBe(false);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    await service.download('qwen');
    expect(service.ready('qwen')).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it('逐块解压固定归档，无需读入整个模型', async () => {
    const f = await fixture();
    const archive = path.join(f.root, 'fixture.zip');
    await writeFile(archive, f.bytes);
    await unpackComponentFile(
      archive,
      f.pkg,
      path.join(f.root, 'output'),
      new AbortController().signal,
    );
    expect(await readFile(path.join(f.root, 'output/speech/model.onnx'))).toEqual(f.data);
  });
  it('Qwen 一个组件依次下载三个资源，任一失败均不启用，重试后离线复用', async () => {
    const f = await fixture();
    const archives = ['asr', 'aligner', 'runtime'].map((name) => {
      const data = Buffer.from(`synthetic ${name}`),
        zip = new Zip();
      const file = {
        path: `qwen/${name}/fixture.bin`,
        bytes: data.length,
        sha256: digest(data),
        mode: 0o644,
      };
      zip.addFile(file.path, data);
      const bytes: Buffer = zip.toBuffer();
      return {
        bytes,
        part: {
          tag: f.pkg.tag,
          asset: `${name}.zip`,
          bytes: bytes.length,
          sha256: digest(bytes),
          files: [file],
        },
      };
    });
    const pkg: ComponentPackage = {
      ...f.pkg,
      id: 'qwen',
      directory: 'qwen',
      bytes: archives.reduce((sum, item) => sum + item.bytes.length, 0),
      sha256: digest(Buffer.from('combined fixed resource identity')),
      files: archives.flatMap((item) => item.part.files),
      parts: archives.map((item) => item.part),
    };
    let fail = true;
    const fetcher = vi.fn(async (url) => {
      const part = archives.find((item) => String(url).endsWith(item.part.asset))!;
      if (fail && part === archives[1]) throw Error('synthetic interrupted alignment resource');
      return new Response(new Uint8Array(part.bytes));
    });
    const service = new ComponentService({
      root: f.root,
      packages: [f.pkg, pkg],
      managed: false,
      managedIds: ['qwen'],
      fetch: fetcher as typeof fetch,
      emit: vi.fn(),
    });
    expect(service.ready('speech')).toBe(true);
    expect((await service.download('qwen')).phase).toBe('error');
    expect(service.ready('qwen')).toBe(false);
    expect(await readdir(f.root)).toEqual([]);
    fail = false;
    expect((await service.download('qwen')).phase).toBe('ready');
    expect(service.ready('qwen')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await service.download('qwen');
    expect(fetcher).toHaveBeenCalledTimes(5);
    await expect(service.remove('speech')).rejects.toThrow('随应用提供');
    expect((await service.remove('qwen')).phase).toBe('needed');
    expect(service.ready('speech')).toBe(true);
  });
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
    if (process.platform === 'win32') {
      // Junctions exercise real reparse-point rejection without requiring
      // SeCreateSymbolicLinkPrivilege or changing the host's Developer Mode.
      const protectedDirectory = path.join(f.root, 'protected-directory');
      await mkdir(protectedDirectory);
      await writeFile(path.join(protectedDirectory, 'model.onnx'), 'original');
      await rm(path.dirname(file), { recursive: true });
      await symlink(protectedDirectory, path.dirname(file), 'junction');
      expect((await f.service().status()).phase).toBe('needed');
      expect(await readFile(path.join(protectedDirectory, 'model.onnx'), 'utf8')).toBe('original');
    } else await symlink(original, file);
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
    expect(packagesFor('darwin', 'arm64').map((p) => p.id)).toEqual(['speech', 'rag', 'qwen']);
    const qwen = packagesFor('darwin', 'arm64').find((pkg) => pkg.id === 'qwen')!;
    expect(qwen.parts).toHaveLength(2);
    expect(qwen.files.every((file) => !file.path.includes('/runtime/'))).toBe(true);
    expect(qwen.parts?.every((part) => !part.asset.includes('Windows'))).toBe(true);
    expect(qwen.version).toBe('1.0.1');
    expect(qwen.files.find((file) => file.path === 'qwen/aligner/model.gguf')?.sha256).toBe(
      '539df5dd0fe1721e378ac13bfac9a26b1260dafb62d892c518c1f21244762636',
    );
    expect(qwen.files.some((file) => file.path === 'qwen/aligner/model.safetensors')).toBe(false);
    const windowsQwen = packagesFor('win32', 'x64').find((pkg) => pkg.id === 'qwen')!;
    expect(windowsQwen.version).toBe('1.0.1');
    expect(windowsQwen.parts).toHaveLength(3);
    expect(windowsQwen.files.some((file) => file.path === 'qwen/aligner/model.safetensors')).toBe(
      false,
    );
    expect(
      windowsQwen.files.some(
        (file) => file.path.endsWith('.gguf') && file.path.includes('/aligner/'),
      ),
    ).toBe(true);
    expect(packagesFor('win32', 'x64').map((p) => p.id)).toEqual(['speech', 'rag', 'qwen']);
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
    await expect(legacy.remove('speech')).rejects.toThrow('随应用提供');
  });
  it('删除仅移除所选模型，保留其他组件与用户资料，并可重新下载', async () => {
    const f = await fixture(),
      second = { ...f.pkg, id: 'rag' as const };
    const service = new ComponentService({
      root: f.root,
      packages: [f.pkg, second],
      managed: true,
      fetch: f.fetcher as typeof fetch,
      emit: vi.fn(),
    });
    await service.download();
    const original = path.join(f.root, 'original.md');
    await writeFile(original, 'Protected user document');
    expect((await service.remove('speech')).phase).toBe('needed');
    expect(service.ready('speech')).toBe(false);
    expect(service.ready('rag')).toBe(true);
    expect(await readdir(f.root)).not.toContain(path.basename(componentLocation(f.root, f.pkg)));
    expect(await readFile(original, 'utf8')).toBe('Protected user document');
    expect((await service.download('speech')).phase).toBe('ready');
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });
  it('使用中拒绝删除；卸载消费者期间阻止新下载和模型使用', async () => {
    const f = await fixture();
    const prepare = vi.fn(async () => false);
    const service = new ComponentService({
      root: f.root,
      packages: [f.pkg],
      managed: true,
      fetch: f.fetcher as typeof fetch,
      emit: vi.fn(),
      prepareRemove: prepare,
    });
    await service.download();
    expect((await service.remove('speech')).error).toMatch(/正在使用/);
    expect(service.ready('speech')).toBe(true);
    let release!: (allowed: boolean) => void;
    prepare.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const removal = service.remove('speech');
    expect(() => service.require('speech')).toThrow(/尚未就绪/);
    expect((await service.status()).phase).toBe('removing');
    await expect(service.download('speech')).rejects.toThrow(/正在删除/);
    await expect(service.remove('speech')).rejects.toThrow(/等待当前/);
    release(true);
    expect((await removal).phase).toBe('needed');
  });
  it('删除拒绝重定向目录、未知内容及下载并发，保护原件和就绪模型', async () => {
    const f = await fixture(),
      service = f.service();
    await service.download();
    const directory = componentLocation(f.root, f.pkg);
    await writeFile(path.join(directory, 'files', 'private.txt'), 'Protected');
    expect((await service.remove('speech')).phase).toBe('error');
    expect(await readFile(path.join(directory, 'files', 'private.txt'), 'utf8')).toBe('Protected');
    await rm(path.join(directory, 'files', 'private.txt'));
    const linked = f.service();
    await linked.status();
    const protectedDirectory = path.join(f.root, 'protected-component');
    await import('node:fs/promises').then((fs) => fs.rename(directory, protectedDirectory));
    await symlink(protectedDirectory, directory, process.platform === 'win32' ? 'junction' : 'dir');
    expect((await linked.remove('speech')).phase).toBe('error');
    expect(await readFile(path.join(protectedDirectory, 'files/speech/model.onnx'))).toEqual(
      f.data,
    );

    const active = await fixture();
    let started!: () => void;
    const downloading = new Promise<void>((resolve) => {
      started = resolve;
    });
    active.fetcher.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(active.bytes.subarray(0, 2)));
              started();
            },
          }),
        ),
    );
    const pending = active.service(),
      download = pending.download();
    await downloading;
    await expect(pending.remove('speech')).rejects.toThrow(/等待当前/);
    await pending.cancel();
    await download;
  });
  it('模型目录顶层出现未知原件时，删除和损坏后的重新下载均保留该原件', async () => {
    const f = await fixture(),
      service = f.service();
    await service.download();
    const directory = componentLocation(f.root, f.pkg);
    const original = path.join(directory, 'user-notes.md');
    await writeFile(original, 'Protected original outside the model files directory');
    expect((await service.remove('speech')).phase).toBe('error');
    expect(await readFile(original, 'utf8')).toContain('Protected original');
    await writeFile(path.join(directory, 'files/speech/model.onnx'), 'damaged');
    const restarted = f.service();
    expect((await restarted.download('speech')).phase).toBe('error');
    expect(await readFile(original, 'utf8')).toContain('Protected original');
  });
});

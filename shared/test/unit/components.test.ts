import { describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../temp';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ComponentService,
  componentLocation,
  componentPaths,
} from '../../../shared/electron/backend/components/service';
import { unpackComponentFile } from '../../../shared/electron/backend/components/archive';
import {
  packagesFor,
  type ComponentPackage,
} from '../../../shared/electron/backend/components/catalog';
import { qwenPackage } from '../../electron/backend/components/qwen-catalog';
import { qwenInt8Aligner } from '../../electron/backend/components/qwen-int8-catalog';
import { qwenWindowsRuntime } from '../../electron/backend/components/qwen-windows-runtime-catalog';
import { componentLeaseAbsent, holdComponentLease } from '../../electron/backend/components/lease';
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
    expect(windows.previous).toEqual([{ package: qwenPackage, preserve: true }]);
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
  it('单项下载只检查所选缓存及安装结果，不重新校验其他已就绪组件', async () => {
    const f = await fixture();
    const packages = [f.pkg, { ...f.pkg, id: 'qwen' as const }, { ...f.pkg, id: 'rag' as const }];
    const emit = vi.fn();
    const service = new ComponentService({
      root: f.root,
      packages,
      managed: true,
      fetch: f.fetcher as typeof fetch,
      emit,
    });
    await service.download();
    await service.remove('speech'); // Invalidates the previous full-cache check.
    emit.mockClear();
    f.fetcher.mockClear();
    const verify = vi.spyOn(
      service as unknown as { verify(directory: string, pkg: ComponentPackage): Promise<boolean> },
      'verify',
    );
    expect((await service.download('speech')).phase).toBe('ready');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls.map(([, pkg]) => pkg.id)).toEqual(['speech', 'speech']);
    for (const [state] of emit.mock.calls) {
      expect(
        state.items
          .filter((item: { id: string }) => item.id !== 'speech')
          .map((item: { phase: string }) => item.phase),
      ).toEqual(['ready', 'ready']);
    }
    service.dispose();
  });
  it('单项缓存离线复用及下载中的状态查询均不触发其他组件校验', async () => {
    const f = await fixture();
    const packages = [f.pkg, { ...f.pkg, id: 'rag' as const }];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async () => {
      await gate;
      return new Response(new Uint8Array(f.bytes));
    });
    const service = new ComponentService({
      root: f.root,
      packages,
      managed: true,
      fetch: fetcher as typeof fetch,
      emit: vi.fn(),
    });
    const verify = vi.spyOn(
      service as unknown as { verify(directory: string, pkg: ComponentPackage): Promise<boolean> },
      'verify',
    );
    const pending = service.download('speech');
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      expect((await service.status()).phase).toBe('downloading');
      expect(verify.mock.calls.map(([, pkg]) => pkg.id)).toEqual(['speech']);
    } finally {
      release();
      await pending;
    }
    verify.mockClear();
    expect(
      (await service.download('speech')).items.find((item) => item.id === 'speech')?.phase,
    ).toBe('ready');
    expect(verify.mock.calls.map(([, pkg]) => pkg.id)).toEqual(['speech']);
    expect(service.state().items.find((item) => item.id === 'rag')?.phase).toBe('pending');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await writeFile(
      path.join(componentLocation(f.root, f.pkg), 'files/speech/model.onnx'),
      Buffer.alloc(f.data.length),
    );
    verify.mockClear();
    await service.download('speech');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls.map(([, pkg]) => pkg.id)).toEqual(['speech', 'speech']);
    expect(
      await readFile(path.join(componentLocation(f.root, f.pkg), 'files/speech/model.onnx')),
    ).toEqual(f.data);
    service.dispose();
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
      'https://github.com/NCFXZ/VoxCue/releases/download/models-v1.0.0/fixture.zip',
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
  it.each(['content-length', 'oversized', 'cancel'] as const)(
    '%s失败不等待底层取消完成，释放暂存与租约后可重试',
    async (mode) => {
      const f = await fixture();
      let releaseCancel!: () => void;
      const cancel = vi.fn(() => new Promise<void>((resolve) => { releaseCancel = resolve; }));
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          if (mode === 'oversized') controller.enqueue(new Uint8Array(f.bytes.length + 1));
        },
        cancel,
      }), mode === 'content-length' ? {
        headers: { 'content-length': String(f.bytes.length + 1) },
      } : undefined);
      let lease!: string;
      f.fetcher.mockImplementationOnce(async () => {
        const [stage] = await readdir(f.root);
        lease = JSON.parse(await readFile(path.join(f.root, stage, '.owner.json'), 'utf8')).lease;
        return response;
      });
      const service = f.service();
      const download = service.download();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
        if (mode === 'cancel') void service.cancel();
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
        const result = await Promise.race([
          download,
          new Promise<'blocked'>((resolve) => { timer = setTimeout(() => resolve('blocked'), 500); }),
        ]);
        expect(result).toHaveProperty('phase', mode === 'cancel' ? 'cancelled' : 'error');
        expect(await readdir(f.root)).toEqual([]);
        expect(await componentLeaseAbsent(lease)).toBe(true);
        expect((await service.download()).phase).toBe('ready');
      } finally {
        clearTimeout(timer);
        // Only the test owner can release the simulated stuck transport for cleanup.
        releaseCancel?.();
        await download;
        service.dispose();
      }
    },
  );
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
    const [stage] = await readdir(f.root);
    const owner = JSON.parse(await readFile(path.join(f.root, stage, '.owner.json'), 'utf8'));
    expect(owner.version).toBe(2);
    await f.service().status();
    expect(await readdir(f.root)).toContain(stage);
    await service.cancel();
    expect((await download).phase).toBe('cancelled');
    expect(await readdir(f.root)).toEqual([]);
    expect(await componentLeaseAbsent(owner.lease)).toBe(true);
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
    const archive = path.join(f.root, 'fixture.zip');
    await writeFile(archive, f.bytes);
    for (const [index, mutate] of [
      (p: ComponentPackage) => (p.files[0].sha256 = '0'.repeat(64)),
      (p: ComponentPackage) => (p.files[0].path = '../protected'),
    ].entries()) {
      const pkg = structuredClone(f.pkg);
      mutate(pkg);
      await expect(
        unpackComponentFile(
          archive,
          pkg,
          path.join(f.root, 'stage-' + index),
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    }
    const zip = new Zip(f.bytes);
    zip.addFile('extra.js', Buffer.from('untrusted'));
    const data = zip.toBuffer();
    await writeFile(archive, data);
    await expect(
      unpackComponentFile(
        archive,
        { ...f.pkg, bytes: data.length, sha256: digest(data) },
        path.join(f.root, 'stage-extra'),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it('归档与清单同时声明越界路径也不能改写目标目录外的文件', async () => {
    const f = await fixture();
    const protectedFile = path.join(f.root, 'protected');
    await writeFile(protectedFile, 'original');
    const zip = new Zip(f.bytes);
    zip.getEntries()[0].entryName = '../protected';
    const bytes: Buffer = zip.toBuffer();
    const pkg = {
      ...f.pkg,
      bytes: bytes.length,
      sha256: digest(bytes),
      files: [{ ...f.pkg.files[0], path: '../protected' }],
    };
    const archive = path.join(f.root, 'traversal.zip');
    await writeFile(archive, bytes);
    await expect(
      unpackComponentFile(archive, pkg, path.join(f.root, 'stage'), new AbortController().signal),
    ).rejects.toThrow('Invalid ZIP file');
    expect(await readFile(protectedFile, 'utf8')).toBe('original');
  });
  it.each(['encrypted', 'symlink', 'local-name'] as const)(
    '认证过的归档仍拒绝 %s 文件元数据',
    async (kind) => {
      const f = await fixture();
      const bytes = Buffer.from(f.bytes);
      const central = bytes.readUInt32LE(bytes.length - 6);
      if (kind === 'encrypted')
        bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
      else if (kind === 'symlink') bytes.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
      else bytes[bytes.readUInt32LE(central + 42) + 30] = 'x'.charCodeAt(0);
      const archive = path.join(f.root, 'invalid.zip');
      await writeFile(archive, bytes);
      await expect(
        unpackComponentFile(
          archive,
          { ...f.pkg, sha256: digest(bytes) },
          path.join(f.root, 'stage'),
          new AbortController().signal,
        ),
      ).rejects.toThrow(kind === 'local-name' ? 'Invalid ZIP filename' : 'Invalid ZIP file');
      expect((await readdir(f.root)).sort()).toEqual(['invalid.zip']);
    },
  );
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
  it('暂存归属使用实际IPC租约，PID复用不阻止清理，旧格式和未知内容保持保护', async () => {
    const f = await fixture();
    const liveLease = randomBytes(16).toString('hex');
    const release = await holdComponentLease(liveLease);
    const deadLease = randomBytes(16).toString('hex');
    const stages: string[] = [];
    for (const owner of [
      { kind: 'voxcue-component-stage', version: 2, lease: deadLease, pid: process.pid },
      { kind: 'voxcue-component-stage', version: 2, lease: liveLease },
      { kind: 'voxcue-component-stage', pid: 2147483647 },
      { kind: 'voxcue-component-stage', version: 2, lease: '../untrusted-endpoint' },
    ]) {
      const directory = path.join(f.root, '.stage-speech-' + randomUUID());
      await mkdir(directory);
      await writeFile(path.join(directory, '.owner.json'), JSON.stringify(owner));
      await writeFile(path.join(directory, 'partial.zip'), 'owned synthetic partial download');
      stages.push(directory);
    }
    try {
      expect(await componentLeaseAbsent(liveLease)).toBe(false);
      await f.service().status();
      await expect(readdir(stages[0])).rejects.toMatchObject({ code: 'ENOENT' });
      for (const directory of stages.slice(1))
        expect(await readFile(path.join(directory, 'partial.zip'), 'utf8')).toContain('synthetic');
    } finally {
      await release();
    }
    expect(await componentLeaseAbsent(liveLease)).toBe(true);
    await f.service().status();
    await expect(readdir(stages[1])).rejects.toMatchObject({ code: 'ENOENT' });
    for (const directory of stages.slice(2)) expect(await readdir(directory)).toContain('.owner.json');
  });
  it.each([false, true])('后继安装完成前不发布就绪，取消=%s时保留可信前驱', async (cancel) => {
    const f = await fixture();
    await f.service().download();
    const next = { ...f.pkg, version: '1.0.1', previous: [{ package: f.pkg }] };
    let reachedGuard!: () => void;
    const prepared = new Promise<void>((resolve) => {
      reachedGuard = resolve;
    });
    let unblock!: (allowed: boolean) => void;
    const service = new ComponentService({
      root: f.root, packages: [next], managed: true, fetch: f.fetcher as typeof fetch,
      emit: vi.fn(),
      prepareRemove: async () => {
        reachedGuard();
        return new Promise<boolean>((resolve) => { unblock = resolve; });
      },
    });
    const install = service.download();
    await prepared;
    expect(service.ready('speech')).toBe(false);
    expect(() => service.require('speech')).toThrow(/尚未就绪/);
    expect(await readFile(path.join(componentLocation(f.root, f.pkg), 'files/speech/model.onnx')))
      .toEqual(f.data);
    const canceled = cancel ? service.cancel() : undefined;
    unblock(true);
    await canceled;
    expect((await install).phase).toBe('ready');
    if (cancel) expect(await readdir(componentLocation(f.root, f.pkg))).toContain('.voxcue-component.json');
    else await expect(readdir(componentLocation(f.root, f.pkg))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(componentLocation(f.root, next), 'files/speech/model.onnx')))
      .toEqual(f.data);
  });
  it.each(['legacy', 'baseline', 'unknown', 'damaged', 'busy', 'throw', 'no-guard', 'undeclared', 'linked', 'current'])(
    '前驱回收保留%s缓存，不影响新安装', async (reason) => {
      const f = await fixture();
      await f.service().download();
      const directory = componentLocation(f.root, f.pkg);
      if (reason === 'legacy')
        await writeFile(path.join(directory, '.voxcue-component.json'), JSON.stringify({ sha256: f.pkg.sha256 }));
      if (reason === 'unknown') await writeFile(path.join(directory, 'private.txt'), 'protected');
      if (reason === 'damaged')
        await writeFile(path.join(directory, 'files/speech/model.onnx'), Buffer.alloc(f.data.length));
      if (reason === 'linked') {
        const original = path.join(f.root, 'protected-original');
        await rename(directory, original);
        await symlink(original, directory, process.platform === 'win32' ? 'junction' : 'dir');
      }
      const next: ComponentPackage = {
        ...f.pkg, version: reason === 'current' ? f.pkg.version : '1.0.1',
        ...(reason === 'undeclared' ? {} : {
          previous: [{ package: f.pkg, ...(reason === 'baseline' ? { preserve: true as const } : {}) }],
        }),
      };
      if (reason === 'current') await rm(directory, { recursive: true });
      const guard = vi.fn(async () => {
        if (reason === 'throw') throw Error('Synthetic consumer failure');
        return reason !== 'busy';
      });
      const options = {
        root: f.root, packages: [next], managed: true, fetch: f.fetcher as typeof fetch,
        emit: vi.fn(), ...(reason === 'no-guard' ? {} : { prepareRemove: guard }),
      };
      const service = new ComponentService(options);
      expect((await service.download()).phase).toBe('ready');
      expect(await readdir(directory)).toContain('.voxcue-component.json');
      expect((await new ComponentService(options).status()).phase).toBe('ready');
      expect(await readdir(directory)).toContain('.voxcue-component.json');
      if (reason === 'unknown') expect(await readFile(path.join(directory, 'private.txt'), 'utf8')).toBe('protected');
      if (['legacy', 'baseline', 'unknown', 'damaged', 'undeclared', 'linked', 'current'].includes(reason))
        expect(guard).not.toHaveBeenCalled();
    },
  );
  it.each(['busy', 'throw'])('安装时%s跳过的可信前驱在下次启动重试，不随状态查询反复回收', async (reason) => {
    const f = await fixture();
    await f.service().download();
    const next = { ...f.pkg, version: '1.0.1', previous: [{ package: f.pkg }] };
    const guard = vi.fn(async () => true).mockImplementationOnce(async () => {
      if (reason === 'throw') throw Error('Synthetic consumer failure');
      return false;
    });
    const options = {
      root: f.root, packages: [next], managed: true, fetch: f.fetcher as typeof fetch,
      emit: vi.fn(), prepareRemove: guard,
    };
    const installed = new ComponentService(options);
    expect((await installed.download()).phase).toBe('ready');
    expect(await readdir(componentLocation(f.root, f.pkg))).toContain('.voxcue-component.json');
    await installed.status();
    expect(guard).toHaveBeenCalledTimes(1);

    const restarted = new ComponentService(options);
    const states = await Promise.all([restarted.status(), restarted.status()]);
    expect(states.every((state) => state.phase === 'ready')).toBe(true);
    await expect(readdir(componentLocation(f.root, f.pkg))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(componentLocation(f.root, next), 'files/speech/model.onnx')))
      .toEqual(f.data);
    await restarted.status();
    expect(guard).toHaveBeenCalledTimes(2);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['damaged', 'missing'])('启动时后继%s不回收可信前驱', async (reason) => {
    const f = await fixture();
    await f.service().download();
    const next = { ...f.pkg, version: '1.0.1', previous: [{ package: f.pkg }] };
    const guard = vi.fn(async () => false);
    const options = {
      root: f.root, packages: [next], managed: true, fetch: f.fetcher as typeof fetch,
      emit: vi.fn(), prepareRemove: guard,
    };
    expect((await new ComponentService(options).download()).phase).toBe('ready');
    const directory = componentLocation(f.root, next);
    if (reason === 'missing') await rm(directory, { recursive: true });
    else await writeFile(path.join(directory, 'files/speech/model.onnx'), Buffer.alloc(f.data.length));
    guard.mockClear().mockResolvedValue(true);
    expect((await new ComponentService(options).status()).phase).toBe('needed');
    expect(guard).not.toHaveBeenCalled();
    expect(await readFile(path.join(componentLocation(f.root, f.pkg), 'files/speech/model.onnx')))
      .toEqual(f.data);
  });
  it.each(['cancel', 'dispose'] as const)('启动回收等待消费者退出时%s保留前驱，完成前不允许使用后继', async (action) => {
    const f = await fixture();
    await f.service().download();
    const next = { ...f.pkg, version: '1.0.1', previous: [{ package: f.pkg }] };
    const options = {
      root: f.root, packages: [next], managed: true, fetch: f.fetcher as typeof fetch,
      emit: vi.fn(), prepareRemove: async () => false,
    };
    expect((await new ComponentService(options).download()).phase).toBe('ready');
    let reachedGuard!: () => void;
    const prepared = new Promise<void>((resolve) => { reachedGuard = resolve; });
    let unblock!: (allowed: boolean) => void;
    const service = new ComponentService({
      ...options,
      prepareRemove: async () => {
        reachedGuard();
        return new Promise<boolean>((resolve) => { unblock = resolve; });
      },
    });
    const checking = service.status();
    await prepared;
    expect(service.ready('speech')).toBe(false);
    expect(() => service.require('speech')).toThrow(/尚未就绪/);
    await service[action]();
    unblock(true);
    await checking;
    expect(await readFile(path.join(componentLocation(f.root, f.pkg), 'files/speech/model.onnx')))
      .toEqual(f.data);
    expect(await readFile(path.join(componentLocation(f.root, next), 'files/speech/model.onnx')))
      .toEqual(f.data);
  });
  it('新包校验失败不回收已安装的可信前驱', async () => {
    const f = await fixture();
    await f.service().download();
    f.fetcher.mockImplementationOnce(async () => new Response(new Uint8Array(f.bytes.length)));
    const guard = vi.fn(async () => true);
    const next = { ...f.pkg, version: '1.0.1', previous: [{ package: f.pkg }] };
    const service = new ComponentService({
      root: f.root, packages: [next], managed: true, fetch: f.fetcher as typeof fetch,
      emit: vi.fn(), prepareRemove: guard,
    });
    expect((await service.download()).phase).toBe('error');
    expect(await readFile(path.join(componentLocation(f.root, f.pkg), 'files/speech/model.onnx')))
      .toEqual(f.data);
    await expect(readdir(componentLocation(f.root, next))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(guard).not.toHaveBeenCalled();
  });
});

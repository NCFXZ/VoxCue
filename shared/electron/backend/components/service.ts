import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { ComponentId, ComponentState } from '../../contracts/components';
import type { ComponentPackage } from './catalog';
import { unpackComponent } from './archive';

export function componentLocation(root: string, pkg: ComponentPackage) {
  return path.join(root, `${pkg.id}-${pkg.version}-${pkg.sha256}`);
}
export function componentPaths(root: string, packages: ComponentPackage[]) {
  const location = (id: ComponentId) => {
    const pkg = packages.find((item) => item.id === id)!;
    return path.join(componentLocation(root, pkg), 'files', pkg.directory);
  };
  return {
    speechModels: location('speech'),
    ragModel: location('rag'),
  };
}

export class ComponentService {
  private value: ComponentState;
  private checking?: Promise<ComponentState>;
  private downloading?: Promise<ComponentState>;
  private removing = false;
  private controller?: AbortController;
  private disposed = false;
  constructor(
    private options: {
      root: string;
      packages: ComponentPackage[];
      managed: boolean;
      fetch: typeof fetch;
      emit(state: ComponentState): void;
      prepareRemove?(id: ComponentId): Promise<boolean>;
    },
  ) {
    this.value = {
      revision: 0,
      phase: options.managed ? 'checking' : 'ready',
      error: null,
      removable: options.managed,
      items: options.packages.map((pkg) => ({
        id: pkg.id,
        label: pkg.label,
        bytes: pkg.bytes,
        received: options.managed ? 0 : pkg.bytes,
        phase: options.managed ? 'pending' : 'ready',
      })),
    };
  }
  state(): ComponentState {
    return structuredClone(this.value);
  }
  ready(id: ComponentId) {
    return this.value.items.some((item) => item.id === id && item.phase === 'ready');
  }
  require(id: ComponentId) {
    if (!this.ready(id))
      throw Error(
        `${this.value.items.find((item) => item.id === id)?.label ?? '本地组件'}尚未就绪，请先下载并完成校验。`,
      );
  }
  private publish(phase: ComponentState['phase'], error: string | null = null) {
    this.value = { ...this.value, revision: this.value.revision + 1, phase, error };
    if (!this.disposed) this.options.emit(this.state());
  }
  status() {
    if (this.removing) return Promise.resolve(this.state());
    if (!this.options.managed || this.checking)
      return this.checking?.then(() => this.state()) ?? Promise.resolve(this.state());
    this.checking = this.check();
    return this.checking;
  }
  private async check() {
    try {
      await this.directory(this.options.root);
      await this.cleanAbandoned();
      for (const pkg of this.options.packages) {
        const item = this.value.items.find((value) => value.id === pkg.id)!;
        item.phase = 'checking';
        this.publish('checking');
        const valid = await this.verify(componentLocation(this.options.root, pkg), pkg);
        item.phase = valid ? 'ready' : 'pending';
        item.received = valid ? pkg.bytes : 0;
      }
      this.publish(this.value.items.every((item) => item.phase === 'ready') ? 'ready' : 'needed');
    } catch {
      this.publish('error', '无法检查本地组件缓存，请确认应用数据目录可写后重试。');
      this.checking = undefined;
    }
    return this.state();
  }
  download(id?: ComponentId) {
    if (this.removing) return Promise.reject(Error('正在删除本地组件，请稍后重试。'));
    if (this.downloading) return this.downloading;
    this.controller = new AbortController();
    this.downloading = this.run(id, this.controller.signal).finally(() => {
      this.downloading = undefined;
      this.controller = undefined;
    });
    return this.downloading;
  }
  async remove(id: ComponentId) {
    if (!this.options.managed) throw Error('此组件随应用提供，无法从设置中删除。');
    if (this.disposed || this.removing || this.downloading || this.value.phase === 'checking')
      throw Error('请等待当前组件操作完成后再删除。');
    const pkg = this.options.packages.find((item) => item.id === id);
    const item = this.value.items.find((item) => item.id === id);
    if (!pkg || !item || item.phase !== 'ready') throw Error('该组件尚未就绪，无法删除。');
    this.removing = true;
    item.phase = 'removing';
    this.publish('removing');
    const directory = componentLocation(this.options.root, pkg);
    let message = '组件删除失败，请检查文件占用与目录权限后重试。';
    try {
      // Retire consumers only after publishing a non-ready state. New model
      // operations are rejected by their independent main-process guards.
      if (this.options.prepareRemove && !(await this.options.prepareRemove(id))) {
        message = '组件正在使用，请结束面试、语音输入或资料处理后再删除。';
        throw Error('Component in use');
      }
      const root = await lstat(this.options.root);
      if (
        !root.isDirectory() ||
        root.isSymbolicLink() ||
        !(await this.knownRoot(directory)) ||
        !(await this.verify(directory, pkg))
      )
        throw Error('Unknown component content is protected');
      await rm(directory, { recursive: true });
      item.phase = 'pending';
      item.received = 0;
      this.checking = undefined;
      this.publish('needed');
    } catch {
      const intact = await this.verify(directory, pkg);
      item.phase = intact ? 'ready' : 'pending';
      item.received = intact ? pkg.bytes : 0;
      this.publish('error', message);
    } finally {
      this.removing = false;
    }
    return this.state();
  }
  cancel() {
    this.controller?.abort();
    return this.downloading ?? Promise.resolve(this.state());
  }
  dispose() {
    this.disposed = true;
    this.controller?.abort();
  }
  private async run(id: ComponentId | undefined, signal: AbortSignal) {
    try {
      await this.status();
      if (!this.options.managed) return this.state();
      for (const pkg of this.options.packages) {
        if ((id && pkg.id !== id) || this.ready(pkg.id)) continue;
        signal.throwIfAborted();
        await this.install(pkg, signal);
      }
      this.publish(this.value.items.every((item) => item.phase === 'ready') ? 'ready' : 'needed');
    } catch {
      for (const item of this.value.items)
        if (item.phase !== 'ready') {
          item.phase = 'pending';
          item.received = 0;
        }
      this.publish(
        signal.aborted ? 'cancelled' : 'error',
        signal.aborted
          ? null
          : '组件下载或校验失败。请检查网络与可用磁盘空间后重试；已就绪的组件会继续保留。',
      );
    }
    return this.state();
  }
  private async directory(directory: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Unsafe component directory');
  }
  private async verify(directory: string, pkg: ComponentPackage) {
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return false;
      const marker = await this.readMarker(directory);
      if (marker.sha256 !== pkg.sha256) return false;
      const expected = new Map(pkg.files.map((file) => [file.path, file]));
      let count = 0;
      const visit = async (folder: string, relative = '') => {
        const directoryInfo = await lstat(folder);
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
          throw Error('Unsafe cache');
        for (const name of await readdir(folder)) {
          const file = path.join(folder, name),
            rel = relative ? relative + '/' + name : name;
          const stat = await lstat(file);
          if (stat.isSymbolicLink()) throw Error('Unsafe cache');
          if (stat.isDirectory()) {
            await visit(file, rel);
            continue;
          }
          const descriptor = expected.get(rel);
          if (!stat.isFile() || !descriptor || stat.size !== descriptor.bytes)
            throw Error('Invalid cache');
          if (process.platform !== 'win32' && descriptor.mode & 0o111 && !(stat.mode & 0o111))
            throw Error('Missing executable mode');
          const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          const hash = createHash('sha256');
          try {
            for await (const chunk of handle.createReadStream({ autoClose: false }))
              hash.update(chunk);
          } finally {
            await handle.close();
          }
          if (hash.digest('hex') !== descriptor.sha256) throw Error('Invalid cache');
          count++;
        }
      };
      await visit(path.join(directory, 'files'));
      return count === expected.size;
    } catch {
      return false;
    }
  }
  private async readMarker(directory: string): Promise<{ sha256: string }> {
    const file = path.join(directory, '.voxcue-component.json');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024)
      throw Error('Invalid cache marker');
    return JSON.parse(await readFile(file, 'utf8'));
  }
  private async knownRoot(directory: string) {
    // Only these top-level entries belong to a published component. Preserve
    // extra user content before either removal or replacement of a bad model.
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    return (await readdir(directory)).every(
      (name) => name === 'files' || name === '.voxcue-component.json',
    );
  }
  private async install(pkg: ComponentPackage, signal: AbortSignal) {
    const item = this.value.items.find((value) => value.id === pkg.id)!;
    const stage = path.join(this.options.root, '.stage-' + pkg.id + '-' + randomUUID());
    await this.directory(stage);
    try {
      await writeFile(
        path.join(stage, '.owner.json'),
        JSON.stringify({ kind: 'voxcue-component-stage', pid: process.pid }),
        { flag: 'wx' },
      );
      item.phase = 'downloading';
      item.received = 0;
      this.publish('downloading');
      const archive = path.join(stage, 'download.zip');
      await this.downloadArchive(pkg, archive, signal, (received) => {
        item.received = received;
        this.publish('downloading');
      });
      item.phase = 'verifying';
      this.publish('verifying');
      await unpackComponent(await readFile(archive), pkg, path.join(stage, 'files'), signal);
      await writeFile(
        path.join(stage, '.voxcue-component.json'),
        JSON.stringify({ sha256: pkg.sha256 }),
        { flag: 'wx' },
      );
      if (!(await this.verify(stage, pkg))) throw Error('Invalid installed component');
      signal.throwIfAborted();
      await rm(archive);
      await rm(path.join(stage, '.owner.json'));
      const destination = componentLocation(this.options.root, pkg);
      let replaced: string | undefined;
      try {
        const existing = await lstat(destination);
        if (
          !existing.isDirectory() ||
          existing.isSymbolicLink() ||
          !(await this.knownRoot(destination)) ||
          (await this.readMarker(destination)).sha256 !== pkg.sha256
        )
          throw Error('Unknown cache content is protected');
        replaced = stage + '-previous';
        await rename(destination, replaced);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await rename(stage, destination);
      } catch (error) {
        if (replaced) await rename(replaced, destination);
        throw error;
      }
      if (replaced) await rm(replaced, { recursive: true, force: true });
      item.phase = 'ready';
      item.received = pkg.bytes;
      this.publish('downloading');
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  private async downloadArchive(
    pkg: ComponentPackage,
    file: string,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ) {
    const timeout = new AbortController();
    const combined = AbortSignal.any([signal, timeout.signal, AbortSignal.timeout(20 * 60 * 1000)]);
    let idle = setTimeout(() => timeout.abort(), 45000);
    const refresh = () => {
      clearTimeout(idle);
      idle = setTimeout(() => timeout.abort(), 45000);
    };
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abort = () => {
      void reader?.cancel().catch(() => {});
    };
    combined.addEventListener('abort', abort, { once: true });
    try {
      const url = `https://github.com/NCFXZ/VoxCue-releases/releases/download/${pkg.tag}/${pkg.asset}`;
      const response = await this.options.fetch(url, {
        signal: combined,
        credentials: 'omit',
        redirect: 'follow',
      });
      if (!response.ok || !response.body) throw Error('Download unavailable');
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== pkg.bytes) {
        await response.body.cancel();
        throw Error('Invalid download size');
      }
      handle = await open(file, 'wx', 0o600);
      reader = response.body.getReader();
      const hash = createHash('sha256');
      let bytes = 0,
        lastProgress = 0;
      for (;;) {
        combined.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        refresh();
        bytes += chunk.value.length;
        if (bytes > pkg.bytes) throw Error('Oversized download');
        hash.update(chunk.value);
        let offset = 0;
        while (offset < chunk.value.length) {
          const result = await handle.write(chunk.value, offset);
          if (!result.bytesWritten) throw Error('Short write');
          offset += result.bytesWritten;
        }
        if (Date.now() - lastProgress >= 150) {
          progress(bytes);
          lastProgress = Date.now();
        }
      }
      combined.throwIfAborted();
      if (bytes !== pkg.bytes || hash.digest('hex') !== pkg.sha256)
        throw Error('Download checksum mismatch');
      await handle.sync();
      progress(bytes);
    } finally {
      clearTimeout(idle);
      combined.removeEventListener('abort', abort);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      await handle?.close();
    }
  }
  private async cleanAbandoned() {
    for (const name of await readdir(this.options.root)) {
      if (!/^\.stage-(speech|rag)-[a-f0-9-]{36}$/.test(name)) continue;
      const directory = path.join(this.options.root, name);
      try {
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        const file = path.join(directory, '.owner.json'),
          info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) continue;
        const owner = JSON.parse(await readFile(file, 'utf8'));
        if (
          owner.kind !== 'voxcue-component-stage' ||
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0
        )
          continue;
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH')
            await rm(directory, { recursive: true, force: true });
        }
      } catch {
        /* Unknown or occupied files remain protected. */
      }
    }
  }
}

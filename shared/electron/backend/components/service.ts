import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  hasReadySpeechModel,
  componentPresentation,
  type ComponentId,
  type ComponentState,
} from '../../contracts/components';
import type { ComponentPackage, ComponentArchive } from './catalog';
import { unpackComponentFile } from './archive';
import { componentLeaseAbsent, holdComponentLease, validComponentLease } from './lease';

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
    ...(packages.some((pkg) => pkg.id === 'qwen') ? { qwenModels: location('qwen') } : {}),
  };
}

export class ComponentService {
  private value: ComponentState;
  private checking?: Promise<ComponentState>;
  private checkingController?: AbortController;
  private downloading?: Promise<ComponentState>;
  private removing = false;
  private controller?: AbortController;
  private disposed = false;
  constructor(
    private options: {
      root: string;
      packages: ComponentPackage[];
      managed: boolean;
      managedIds?: ComponentId[];
      fetch: typeof fetch;
      emit(state: ComponentState): void;
      prepareRemove?(id: ComponentId): Promise<boolean>;
    },
  ) {
    this.value = {
      revision: 0,
      phase: options.managed || options.managedIds?.length ? 'checking' : 'ready',
      error: null,
      removable: options.managed || !!options.managedIds?.length,
      items: options.packages.map((pkg) => ({
        id: pkg.id,
        label: pkg.label,
        bytes: pkg.bytes,
        received: this.managed(pkg.id) ? 0 : pkg.bytes,
        phase: this.managed(pkg.id) ? 'pending' : 'ready',
        removable: this.managed(pkg.id),
        ...(pkg.optional ? { optional: true } : {}),
      })),
    };
  }
  state(): ComponentState {
    return structuredClone(this.value);
  }
  private managed(id: ComponentId) {
    return this.options.managed || !!this.options.managedIds?.includes(id);
  }
  private requiredReady() {
    return this.value.items.every(
      (item) =>
        item.optional ||
        item.phase === 'ready' ||
        (item.id === 'speech' && hasReadySpeechModel(this.value)),
    );
  }
  ready(id: ComponentId) {
    return this.value.items.some((item) => item.id === id && item.phase === 'ready');
  }
  require(id: ComponentId) {
    if (!this.ready(id))
      throw Error(
        `${componentPresentation[id].label}尚未就绪，请先下载并完成校验。`,
      );
  }
  private publish(phase: ComponentState['phase'], error: string | null = null) {
    this.value = { ...this.value, revision: this.value.revision + 1, phase, error };
    if (!this.disposed) this.options.emit(this.state());
  }
  status() {
    if (this.removing || this.downloading) return Promise.resolve(this.state());
    if ((!this.options.managed && !this.options.managedIds?.length) || this.checking)
      return this.checking?.then(() => this.state()) ?? Promise.resolve(this.state());
    this.checking = this.check();
    return this.checking;
  }
  private async check(id?: ComponentId) {
    const controller = new AbortController();
    this.checkingController = controller;
    try {
      await this.directory(this.options.root);
      await this.cleanAbandoned(controller.signal);
      for (const pkg of this.options.packages) {
        if (!this.managed(pkg.id) || (id && pkg.id !== id)) continue;
        const item = this.value.items.find((value) => value.id === pkg.id)!;
        item.phase = 'checking';
        this.publish('checking');
        const valid = await this.verify(componentLocation(this.options.root, pkg), pkg, controller.signal);
        if (valid) await this.reclaimPrevious(pkg, controller.signal);
        item.phase = valid ? 'ready' : 'pending';
        item.received = valid ? pkg.bytes : 0;
      }
      this.publish(this.requiredReady() ? 'ready' : 'needed');
    } catch {
      if (controller.signal.aborted) {
        for (const item of this.value.items) if (item.phase === 'checking') item.phase = 'pending';
        this.publish('cancelled');
      } else this.publish('error', '无法检查本地组件缓存，请确认应用数据目录可写后重试。');
      this.checking = undefined;
    } finally {
      if (this.checkingController === controller) this.checkingController = undefined;
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
    if (!this.managed(id)) throw Error('此组件随应用提供，无法从设置中删除。');
    if (this.disposed || this.removing || this.downloading || this.value.phase === 'checking')
      throw Error('请等待当前组件操作完成后再删除。');
    const pkg = this.options.packages.find((item) => item.id === id);
    const item = this.value.items.find((item) => item.id === id);
    if (!pkg || !item || item.phase !== 'ready') throw Error('该组件尚未就绪，无法删除。');
    this.removing = true;
    item.phase = 'removing';
    this.publish('removing');
    const directory = componentLocation(this.options.root, pkg);
    try {
      // Retire consumers only after publishing a non-ready state. New model
      // operations are rejected by their independent main-process guards.
      if (this.options.prepareRemove && !(await this.options.prepareRemove(id))) {
        item.phase = 'ready';
        this.publish('error', '组件正在使用，请结束面试、音频测试或资料处理后再删除。');
        return this.state();
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
      this.publish(this.requiredReady() ? 'ready' : 'needed');
    } catch {
      const intact = await this.verify(directory, pkg);
      item.phase = intact ? 'ready' : 'pending';
      item.received = intact ? pkg.bytes : 0;
      this.publish('error', '组件删除失败，请检查文件占用与目录权限后重试。');
    } finally {
      this.removing = false;
    }
    return this.state();
  }
  cancel() {
    this.controller?.abort();
    this.checkingController?.abort();
    return this.downloading ?? Promise.resolve(this.state());
  }
  dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.checkingController?.abort();
  }
  private async run(id: ComponentId | undefined, signal: AbortSignal) {
    try {
      if (!this.options.managed && !this.options.managedIds?.length) return this.state();
      if (id) {
        // A selected download revalidates only its own cache. An already-running
        // startup scan finishes first; status observers never start another scan
        // during this operation. Other component readiness stays unchanged.
        await this.checking;
        signal.throwIfAborted();
        await this.check(id);
      } else await this.status();
      signal.throwIfAborted();
      for (const pkg of this.options.packages) {
        if (
          !this.managed(pkg.id) ||
          (!id && pkg.optional) ||
          (id && pkg.id !== id) ||
          this.ready(pkg.id)
        )
          continue;
        signal.throwIfAborted();
        await this.install(pkg, signal);
      }
      this.publish(this.requiredReady() ? 'ready' : 'needed');
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
  private async verify(directory: string, pkg: ComponentPackage, signal?: AbortSignal) {
    try {
      signal?.throwIfAborted();
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
          signal?.throwIfAborted();
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
            for await (const chunk of handle.createReadStream({ autoClose: false, signal })) {
              signal?.throwIfAborted();
              hash.update(chunk);
            }
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
      signal?.throwIfAborted();
      return false;
    }
  }
  private async readMarker(directory: string): Promise<{ sha256: string; ownership?: number }> {
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
    const next = path.join(stage, 'next');
    const previous = path.join(stage, 'previous');
    const destination = componentLocation(this.options.root, pkg);
    await this.directory(stage);
    let releaseLease: (() => Promise<void>) | undefined;
    let restorePrevious = false;
    try {
      const lease = randomBytes(16).toString('hex');
      releaseLease = await holdComponentLease(lease);
      await writeFile(
        path.join(stage, '.owner.json'),
        JSON.stringify({ kind: 'voxcue-component-stage', version: 3, lease, target: path.basename(destination) }),
        { flag: 'wx' },
      );
      await this.directory(next);
      item.phase = 'downloading';
      item.received = 0;
      this.publish('downloading');
      let completed = 0;
      for (const [index, part] of (pkg.parts ?? [pkg]).entries()) {
        const archive = path.join(stage, `download-${index}.zip`);
        item.phase = 'downloading';
        await this.downloadArchive(part, archive, signal, (received) => {
          item.received = completed + received;
          this.publish('downloading');
        });
        item.phase = 'verifying';
        this.publish('verifying');
        await unpackComponentFile(archive, part, path.join(next, 'files'), signal);
        completed += part.bytes;
        await rm(archive);
      }
      await writeFile(
        path.join(next, '.voxcue-component.json'),
        JSON.stringify({ sha256: pkg.sha256, ownership: 1 }),
        { flag: 'wx' },
      );
      if (!(await this.verify(next, pkg, signal))) throw Error('Invalid installed component');
      signal.throwIfAborted();
      try {
        const existing = await lstat(destination);
        if (
          !existing.isDirectory() ||
          existing.isSymbolicLink() ||
          !(await this.knownRoot(destination)) ||
          (await this.readMarker(destination)).sha256 !== pkg.sha256
        )
          throw Error('Unknown cache content is protected');
        await rename(destination, previous);
        restorePrevious = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await rename(next, destination);
        restorePrevious = false;
      } catch (error) {
        if (restorePrevious) {
          await rename(previous, destination);
          restorePrevious = false;
        }
        throw error;
      }
      await this.reclaimPrevious(pkg, signal);
      item.phase = 'ready';
      item.received = pkg.bytes;
      this.publish('downloading');
    } finally {
      try {
        if (!restorePrevious) await rm(stage, { recursive: true, force: true });
      } finally {
        await releaseLease?.();
      }
    }
  }

  private async reclaimPrevious(pkg: ComponentPackage, signal: AbortSignal) {
    for (const previous of pkg.previous ?? []) {
      if (signal.aborted || this.disposed) return;
      // Candidates come only from this build's trusted catalog. Never discover
      // history by sweeping cache names or trusting a locally supplied manifest.
      const old = previous.package;
      if (previous.preserve || old.id !== pkg.id || !this.options.prepareRemove) continue;
      const directory = path.resolve(componentLocation(this.options.root, old));
      if (
        path.dirname(directory) !== path.resolve(this.options.root) ||
        this.options.packages.some(
          (current) => path.resolve(componentLocation(this.options.root, current)) === directory,
        )
      ) continue;
      try {
        await this.directory(this.options.root);
        const marker = await this.readMarker(directory);
        // Old caches are never retroactively claimed. Only installs completed
        // under this ownership policy can be reclaimed by a later successor.
        if (
          marker.ownership !== 1 || marker.sha256 !== old.sha256 ||
          !(await this.knownRoot(directory)) || !(await this.verify(directory, old, signal)) ||
          !(await this.options.prepareRemove(old.id))
        ) continue;
        if (!signal.aborted && !this.disposed)
          await rm(directory, { recursive: true });
      } catch {
        // Occupied, changed, unknown or protected predecessors remain in place;
        // optional housekeeping must never invalidate the completed new install.
      }
    }
  }
  private async downloadArchive(
    pkg: ComponentArchive,
    file: string,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ) {
    const timeout = new AbortController();
    const combined = AbortSignal.any([
      signal,
      timeout.signal,
      AbortSignal.timeout(120 * 60 * 1000),
    ]);
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
      const url = `https://github.com/NCFXZ/VoxCue/releases/download/${pkg.tag}/${pkg.asset}`;
      const response = await this.options.fetch(url, {
        signal: combined,
        credentials: 'omit',
        redirect: 'follow',
      });
      if (!response.ok || !response.body) throw Error('Download unavailable');
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== pkg.bytes) {
        void response.body.cancel().catch(() => {});
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
      // A stuck transport cancellation must not retain the file or stage lease.
      void reader?.cancel().catch(() => {});
      reader?.releaseLock();
      await handle?.close();
    }
  }
  private async recoverReplacement(stage: string, pkg: ComponentPackage | undefined, signal: AbortSignal) {
    const previous = path.join(stage, 'previous');
    const hasPrevious = (await readdir(stage)).includes('previous');
    if (!pkg) return !hasPrevious;
    if (hasPrevious && (!(await this.knownRoot(previous)) ||
      (await this.readMarker(previous)).sha256 !== pkg.sha256)) return false;

    const destination = componentLocation(this.options.root, pkg);
    const installed = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (installed) return !hasPrevious || this.verify(destination, pkg, signal);

    const next = path.join(stage, 'next');
    if (await this.verify(next, pkg, signal) && await this.knownRoot(next)) await rename(next, destination);
    else if (hasPrevious) await rename(previous, destination);
    return true;
  }
  private async cleanAbandoned(signal: AbortSignal) {
    for (const name of await readdir(this.options.root)) {
      signal.throwIfAborted();
      if (!/^\.stage-(speech|qwen|rag)-[a-f0-9-]{36}$/.test(name)) continue;
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
          (owner.version !== 2 && owner.version !== 3) ||
          !validComponentLease(owner.lease)
        )
          continue;
        if (!(await componentLeaseAbsent(owner.lease))) continue;
        if (owner.version === 3) {
          const pkg = this.options.packages.find(item =>
            name.startsWith('.stage-' + item.id + '-') &&
            path.basename(componentLocation(this.options.root, item)) === owner.target);
          if (!(await this.recoverReplacement(directory, pkg, signal))) continue;
        }
        await rm(directory, { recursive: true, force: true });
      } catch {
        signal.throwIfAborted();
        /* Unknown or occupied files remain protected. */
      }
    }
  }
}

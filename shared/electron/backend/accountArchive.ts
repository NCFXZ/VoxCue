import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { FileHandle } from 'node:fs/promises';
import type { AccountExportCall, AccountDataResult } from '../contracts/accountData';
import { interviewImageMediaType, validImageId } from './interview/images';
import { copyAccountExport, recoverExportOutputs } from './accountExportOutput';
import { holdOperationLease, operationLeaseAbsent, validLeaseToken } from './operationLease';

const stagePrefix = 'voxcue-account-export-';

export async function recoverAccountExports(temporary = os.tmpdir()) {
  const parent = await fs.realpath(temporary);
  for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(stagePrefix)) continue;
    const token = entry.name.slice(stagePrefix.length);
    const legacy = /^[a-zA-Z0-9]{6}$/.test(token);
    if (!legacy && !validLeaseToken(token)) continue;
    const root = path.join(parent, entry.name);
    try {
      const stat = await fs.lstat(root);
      if (await fs.realpath(root) !== root || (process.getuid && stat.uid !== process.getuid())) continue;
      const marker = path.join(root, '.owner');
      const info = await fs.lstat(marker);
      if (!info.isFile() || info.size > 256 || info.uid !== stat.uid) continue;
      const owner = JSON.parse(await fs.readFile(marker, 'utf8'));
      if (!(await fs.readdir(root)).every(name =>
        ['.owner', 'data', 'images', '资料.zip', 'moved-images'].includes(name))) continue;
      if (legacy) {
        const pid = typeof owner === 'number' ? owner :
          owner?.kind === 'voxcue-account-export' && owner.stage === entry.name &&
          Object.keys(owner).every(k => ['kind', 'stage', 'pid'].includes(k)) ? owner.pid : undefined;
        if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) continue;
        try { process.kill(pid, 0); continue; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
        }
      } else {
        if (owner?.version !== 2 || owner.kind !== 'voxcue-account-export' || owner.stage !== entry.name ||
            owner.token !== token || Object.keys(owner).length !== 4 ||
            !(await operationLeaseAbsent('account-export-stage', token))) continue;
      }
      await fs.rm(root, { recursive: true, force: true });
    } catch { /* Preserve unknown, inaccessible and concurrently removed directories. */ }
  }
}

export function archiveName(value: string) {
  let name = value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '');
  if (name.length > 140) name = name.slice(0, 125) + path.extname(name).slice(0, 15);
  return !name || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(name) ? '_' + name : name;
}
/** Use the OS ZIP writer so a large library never accumulates in JavaScript memory. */
export async function zipDirectory(source: string, destination: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const windows = process.platform === 'win32';
  const script =
    "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $source=$env:VOXCUE_ZIP_SOURCE; $zip=[System.IO.Compression.ZipFile]::Open($env:VOXCUE_ZIP_DESTINATION,[System.IO.Compression.ZipArchiveMode]::Create); try { foreach($dir in [System.IO.Directory]::EnumerateDirectories($source,'*',[System.IO.SearchOption]::AllDirectories)) { $name=$dir.Substring($source.Length+1).Replace([char]92,[char]47)+'/'; $null=$zip.CreateEntry($name) }; foreach($file in [System.IO.Directory]::EnumerateFiles($source,'*',[System.IO.SearchOption]::AllDirectories)) { $name=$file.Substring($source.Length+1).Replace([char]92,[char]47); $null=[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file,$name,[System.IO.Compression.CompressionLevel]::Optimal) } } finally { $zip.Dispose() }";
  const command = windows
    ? path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
    : '/usr/bin/ditto';
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 5 * 60_000).unref();
  const cancelled = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        command,
        windows
          ? [
              '-NoProfile',
              '-NonInteractive',
              '-EncodedCommand',
              Buffer.from(script, 'utf16le').toString('base64'),
            ]
          : ['-c', '-k', '--norsrc', '--noextattr', source, destination],
        {
          windowsHide: true,
          stdio: 'ignore',
          signal: cancelled,
          killSignal: 'SIGKILL',
          env: { ...process.env, VOXCUE_ZIP_SOURCE: source, VOXCUE_ZIP_DESTINATION: destination },
        },
      );
      let failed = false;
      child.once('error', () => {
        failed = true;
      });
      // Wait for actual process shutdown before removing its source/output files.
      child.once('close', (code) => {
        if (!failed && code === 0 && !cancelled.aborted) resolve();
        else
          reject(
            Error(
              signal?.aborted
                ? '导出已取消。'
                : deadline.signal.aborted
                  ? '生成压缩包超时，请重试。'
                  : '无法生成压缩包，请检查存储空间或系统策略。',
            ),
          );
      });
    });
  } finally {
    clearTimeout(timer);
  }
}
export class AccountArchive {
  private active?: {
    token: string;
    owner: string;
    root: string;
    destination: string;
    remaining: number;
    personal: boolean;
    used: Set<string>;
    bases: Map<string, string>;
    stagedImages: Map<string, string>;
    file?: { handle: FileHandle; remaining: number };
    timer: ReturnType<typeof setTimeout>;
    controller: AbortController;
    releaseLease(): Promise<void>;
  };
  private busy = false;
  private closed = false;
  private generation = 0;
  private cancelling = 0;
  private cleanupWork: Promise<void> = Promise.resolve();
  private idleWaiters: (() => void)[] = [];
  private readonly outputRecovery: Promise<void>;
  constructor(
    private ports: {
      userData: string;
      choose(): Promise<string | undefined>;
      image(id: string): Promise<{ bytes: Buffer; extension: string }>;
      zip?: typeof zipDirectory;
    },
  ) {
    this.outputRecovery = recoverExportOutputs(ports.userData).catch(() => {});
  }
  hasWork() {
    return this.busy || !!this.active || this.cancelling > 0;
  }
  async dispose() {
    this.closed = true;
    await this.cancel();
  }
  private detach() {
    this.generation++;
    const active = this.active;
    this.active = undefined;
    if (active) {
      clearTimeout(active.timer);
      active.controller.abort();
    }
    return active;
  }
  private async remove(active: NonNullable<AccountArchive['active']> | undefined) {
    if (!active) return;
    try {
      await active.file?.handle.close();
      const real = await fs.realpath(active.root);
      if (real !== active.root || !path.basename(real).startsWith(stagePrefix))
        throw Error('临时导出路径已变化。');
      await fs.rm(real, { recursive: true, force: true });
    } finally {
      await active.releaseLease();
    }
  }
  async cancel() {
    // Invalidate before waiting: a dialog, file write or ZIP operation already
    // in flight must never revive the task or commit after its owner leaves.
    const active = this.detach();
    if (!active && !this.busy && !this.cancelling) return;
    this.cancelling++;
    const idle = this.busy
      ? new Promise<void>((resolve) => this.idleWaiters.push(resolve))
      : Promise.resolve();
    const work = this.cleanupWork.then(async () => {
      await idle;
      await this.remove(active);
    });
    this.cleanupWork = work.catch(() => {});
    try {
      await work;
    } finally {
      this.cancelling--;
    }
  }
  private async cancelCurrent() {
    await this.remove(this.detach());
  }
  async call(owner: string, call: AccountExportCall): Promise<AccountDataResult> {
    if (
      !call ||
      typeof call !== 'object' ||
      !['begin', 'base', 'file', 'chunk', 'stageImage', 'end', 'finish', 'cancel'].includes(call.action)
    )
      return { ok: false, error: '无效的导出请求。' };
    if (this.closed) return { ok: false, error: '资料导出已关闭。' };
    if (this.busy || this.cancelling) return { ok: false, error: '资料正在导出，请稍候。' };
    this.busy = true;
    const generation = this.generation;
    try {
      if (!owner) throw Error('请先登录 VoxCue 账号。');
      if (call.action === 'begin') {
        if (!Number.isSafeInteger(call.files) || call.files < 1 || call.files > 100000)
          throw Error('导出文件数量无效。');
        if (this.active) throw Error('已有资料正在导出。');
        const destination = await this.ports.choose();
        if (generation !== this.generation || this.closed) throw Error('导出已取消或账号已变化。');
        if (!destination) return { ok: true, canceled: true };
        const parent = await fs.realpath(path.dirname(destination));
        const data = await fs.realpath(this.ports.userData);
        const relative = path.relative(data, parent);
        if (
          !relative ||
          (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
        )
          throw Error('请选择应用资料目录以外的保存位置。');
        const stageId = randomUUID().replaceAll('-', '');
        const root = path.join(await fs.realpath(os.tmpdir()), stagePrefix + stageId);
        const releaseLease = await holdOperationLease('account-export-stage', stageId);
        try {
          await fs.mkdir(root, { mode: 0o700 });
          if (generation !== this.generation || this.closed) {
            await fs.rmdir(root);
            throw Error('导出已取消或账号已变化。');
          }
        } catch (error) {
          await releaseLease();
          throw error;
        }
        const timer = setTimeout(() => {
          if (!this.busy) void this.cancel().catch(() => {});
        }, 15 * 60000).unref();
        this.active = {
          owner,
          token: randomUUID(),
          root,
          destination: path.join(parent, path.basename(destination)),
          remaining: call.files,
          personal: false,
          used: new Set(),
          bases: new Map(),
          stagedImages: new Map(),
          timer,
          controller: new AbortController(),
          releaseLease,
        };
        await fs.writeFile(path.join(root, '.owner'), JSON.stringify({
          kind: 'voxcue-account-export', version: 2, stage: path.basename(root), token: stageId,
        }), { mode: 0o600, flag: 'wx' });
        for (const folder of ['个人信息', '面试记录', '知识库'])
          await fs.mkdir(path.join(root, 'data', folder), { recursive: true, mode: 0o700 });
        if (generation !== this.generation || this.closed) throw Error('导出已取消或账号已变化。');
        return { ok: true, token: this.active.token };
      }
      const a = this.active;
      if (!a || a.owner !== owner || a.token !== call.token)
        throw Error('导出已取消或账号已变化。');
      a.timer.refresh();
      if (call.action === 'cancel') {
        await this.cancelCurrent();
        return { ok: true, canceled: true };
      }
      if (call.action === 'stageImage') {
        if (a.file || !validImageId(call.id) || a.stagedImages.has(call.id) || a.stagedImages.size >= 8192 ||
          !(call.bytes instanceof Uint8Array) || call.bytes.byteLength > 8 * 1024 ** 2)
          throw Error('截图引用无效。');
        const extension = interviewImageMediaType(call.bytes) === 'image/png' ? 'png' : 'jpg';
        const folder = path.join(a.root, 'moved-images');
        await fs.mkdir(folder, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(folder, call.id), call.bytes, { flag: 'wx', mode: 0o600 });
        a.stagedImages.set(call.id, extension);
      } else if (call.action === 'base') {
        if (
          typeof call.baseId !== 'string' ||
          !call.baseId ||
          call.baseId.length > 200 ||
          typeof call.baseName !== 'string' ||
          call.baseName.length > 200 ||
          a.bases.has(call.baseId)
        )
          throw Error('知识库无效。');
        const base = archiveName(call.baseName) + '-' + (a.bases.size + 1);
        a.bases.set(call.baseId, base);
        await fs.mkdir(path.join(a.root, 'data', '知识库', base));
      } else if (call.action === 'file') {
        if (
          a.file ||
          a.remaining <= 0 ||
          !Number.isSafeInteger(call.size) ||
          call.size < 0 ||
          call.size > 20 * 1024 * 1024 ||
          typeof call.name !== 'string' ||
          call.name.length > 500
        )
          throw Error('导出文件无效。');
        let folder: string,
          name = archiveName(call.name);
        if (call.kind === 'personal') {
          if (a.personal) throw Error('个人信息重复。');
          a.personal = true;
          folder = '个人信息';
          name = '个人信息.txt';
        } else if (call.kind === 'record') {
          folder = '面试记录';
          if (!name.endsWith('.txt')) throw Error('转录格式无效。');
        } else if (call.kind === 'document') {
          if (
            typeof call.baseId !== 'string' ||
            !call.baseId ||
            call.baseId.length > 200 ||
            typeof call.baseName !== 'string' ||
            call.baseName.length > 200
          )
            throw Error('知识库无效。');
          let base = a.bases.get(call.baseId);
          if (!base) {
            base = archiveName(call.baseName) + '-' + (a.bases.size + 1);
            a.bases.set(call.baseId, base);
          }
          folder = path.join('知识库', base);
        } else throw Error('导出类别无效。');
        let relative = path.join(folder, name),
          suffix = 1;
        while (a.used.has(relative.toLowerCase())) {
          relative = path.join(folder, path.parse(name).name + '-' + suffix++ + path.extname(name));
        }
        a.used.add(relative.toLowerCase());
        const file = path.join(a.root, 'data', relative);
        await fs.mkdir(path.dirname(file), { recursive: true });
        a.file = { handle: await fs.open(file, 'wx', 0o600), remaining: call.size };
        if (call.images !== undefined) {
          if (
            call.kind !== 'record' ||
            !Array.isArray(call.images) ||
            call.images.length > 10000 ||
            call.images.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
          )
            throw Error('截图引用无效。');
          if (call.images.length) {
            const images = path.join(a.root, 'images');
            await fs.mkdir(images);
            for (const [i, id] of [...new Set(call.images)].entries()) {
              a.controller.signal.throwIfAborted();
              const extension = a.stagedImages.get(id);
              const image = extension
                ? { extension, bytes: await fs.readFile(path.join(a.root, 'moved-images', id)) }
                : await this.ports.image(id);
              a.controller.signal.throwIfAborted();
              await fs.writeFile(path.join(images, `${i + 1}.${image.extension}`), image.bytes, {
                flag: 'wx',
                mode: 0o600,
                signal: a.controller.signal,
              });
            }
            await (this.ports.zip ?? zipDirectory)(
              images,
              file.slice(0, -4) + '-截图.zip',
              a.controller.signal,
            );
            await fs.rm(images, { recursive: true });
          }
        }
      } else if (call.action === 'chunk') {
        if (
          !a.file ||
          !(call.bytes instanceof Uint8Array) ||
          call.bytes.byteLength < 1 ||
          call.bytes.byteLength > 1048576 ||
          call.bytes.byteLength > a.file.remaining
        )
          throw Error('导出分块无效。');
        const bytes = Buffer.from(call.bytes);
        let offset = 0;
        while (offset < bytes.length) {
          const written = (await a.file.handle.write(bytes, offset, bytes.length - offset))
            .bytesWritten;
          if (!written) throw Error('资料写入未完成，请检查存储空间。');
          offset += written;
        }
        a.file.remaining -= bytes.length;
      } else if (call.action === 'end') {
        if (!a.file || a.file.remaining) throw Error('文件尚未完整导出。');
        await a.file.handle.close();
        a.file = undefined;
        a.remaining--;
      } else if (call.action === 'finish') {
        if (a.file || a.remaining || !a.personal) throw Error('资料尚未完整导出。');
        const zip = path.join(a.root, '资料.zip');
        await (this.ports.zip ?? zipDirectory)(path.join(a.root, 'data'), zip, a.controller.signal);
        await this.outputRecovery;
        if (await fs.realpath(path.dirname(a.destination)) !== path.dirname(a.destination)) throw Error('临时导出路径已变化。');
        if (this.active !== a) throw Error('导出已取消或账号已变化。');
        try {
          await fs.rename(zip, a.destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
          await copyAccountExport(zip, a.destination, this.ports.userData, a.controller.signal);
        }
        await this.cancelCurrent();
        return { ok: true, saved: true };
      } else throw Error('无效的导出请求。');
      if (this.active !== a) throw Error('导出已取消或账号已变化。');
      return { ok: true };
    } catch (error) {
      if (
        this.active?.owner === owner &&
        (call.action === 'begin' || this.active.token === call.token)
      )
        await this.cancelCurrent().catch(() => {});
      return { ok: false, error: error instanceof Error ? error.message : '资料导出失败。' };
    } finally {
      this.busy = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
}

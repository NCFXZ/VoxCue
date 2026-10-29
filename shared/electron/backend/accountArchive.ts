import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { FileHandle } from 'node:fs/promises';
import type { AccountDataCall, AccountDataResult } from '../contracts/accountData';

export function archiveName(value: string) {
  let name = value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '');
  if (name.length > 140) name = name.slice(0, 125) + path.extname(name).slice(0, 15);
  return !name || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(name) ? '_' + name : name;
}
/** Use the OS ZIP writer so a large library never accumulates in JavaScript memory. */
export async function zipDirectory(source: string, destination: string) {
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
        env: { ...process.env, VOXCUE_ZIP_SOURCE: source, VOXCUE_ZIP_DESTINATION: destination },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error('无法生成压缩包，请检查存储空间。')),
    );
  });
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
    file?: { handle: FileHandle; remaining: number };
    timer: ReturnType<typeof setTimeout>;
  };
  private busy = false;
  private closed = false;
  private generation = 0;
  private cancelling = 0;
  private cleanupWork: Promise<void> = Promise.resolve();
  private idleWaiters: (() => void)[] = [];
  constructor(
    private ports: {
      userData: string;
      choose(): Promise<string | undefined>;
      image(id: string): Promise<{ bytes: Buffer; extension: string }>;
      zip?: typeof zipDirectory;
    },
  ) {}
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
    if (active) clearTimeout(active.timer);
    return active;
  }
  private async remove(active: NonNullable<AccountArchive['active']> | undefined) {
    if (!active) return;
    await active.file?.handle.close();
    const real = await fs.realpath(active.root);
    if (real !== active.root || !path.basename(real).startsWith('voxcue-account-export-'))
      throw Error('临时导出路径已变化。');
    await fs.rm(real, { recursive: true, force: true });
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
  async call(owner: string, call: AccountDataCall): Promise<AccountDataResult> {
    if (
      !call ||
      typeof call !== 'object' ||
      !['begin', 'base', 'file', 'chunk', 'end', 'finish', 'cancel'].includes(call.action)
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
        const root = await fs.realpath(
          await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-account-export-')),
        );
        if (generation !== this.generation || this.closed) {
          await fs.rm(root, { recursive: true, force: true });
          throw Error('导出已取消或账号已变化。');
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
          timer,
        };
        await fs.writeFile(path.join(root, '.owner'), String(process.pid), { mode: 0o600 });
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
      if (call.action === 'base') {
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
              const image = await this.ports.image(id);
              await fs.writeFile(path.join(images, `${i + 1}.${image.extension}`), image.bytes, {
                flag: 'wx',
                mode: 0o600,
              });
            }
            await (this.ports.zip ?? zipDirectory)(images, file.slice(0, -4) + '-截图.zip');
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
        await (this.ports.zip ?? zipDirectory)(path.join(a.root, 'data'), zip);
        if (this.active !== a) throw Error('导出已取消或账号已变化。');
        // Existing user files are only replaced after the complete ZIP is ready.
        const temporary = a.destination + '.' + randomUUID() + '.tmp';
        try {
          await fs.copyFile(zip, temporary, 1);
          if (this.active !== a) throw Error('导出已取消或账号已变化。');
          await fs.rename(temporary, a.destination);
        } finally {
          await fs.rm(temporary, { force: true });
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

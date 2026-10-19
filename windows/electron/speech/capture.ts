import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AudioDevice, AudioSource } from '../../../shared/electron/contracts/speech';
import { PacketDecoder, type AudioPacket } from '../../../shared/electron/backend/speech/buffer';
export function probeDevice(
  helper: string,
  source: AudioSource,
  device?: string,
): Promise<{ ok: boolean; code?: string }> {
  return new Promise((resolve) => {
    execFile(
      helper,
      ['check', source, Buffer.from(device ?? '').toString('base64')],
      { windowsHide: true, timeout: 5000, maxBuffer: 10000 },
      (error, stdout, stderr) => {
        try {
          if (!error && JSON.parse(stdout).ok === true) return resolve({ ok: true });
          const failure = JSON.parse(stderr.trim());
          if (/^0x[0-9a-f]{8}$/i.test(failure.code))
            return resolve({ ok: false, code: failure.code.toUpperCase() });
        } catch {
          /* Malformed or missing helper output fails closed. */
        }
        resolve({ ok: false });
      },
    );
  });
}
export function devices(helper: string): Promise<AudioDevice[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ['devices'], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('读取音频设备超时。'));
    }, 5000);
    child.stdout.on('data', (b) => {
      out += b;
      if (out.length > 100000) {
        child.kill();
        reject(Error('Invalid device inventory'));
      }
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('音频采集助手缺失；请运行 pnpm build:audio。'));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw Error();
        resolve(JSON.parse(out));
      } catch {
        reject(Error('无法枚举 Windows 音频设备。'));
      }
    });
  });
}
export class WasapiCapture {
  private child?: ChildProcessWithoutNullStreams;
  private closed?: Promise<void>;
  private stopping = false;
  constructor(
    private helper: string,
    private source: AudioSource,
    private device: string | undefined,
    private audio: (p: AudioPacket) => void,
    private failure: (message: string) => void,
  ) {}
  start(): Promise<void> {
    this.stopping = false;
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.helper,
        [this.source, Buffer.from(this.device ?? '').toString('base64')],
        { windowsHide: true },
      );
      this.child = child;
      // exit can precede the last stdout packet. close follows all pipe data.
      this.closed = new Promise((done) => child.once('close', () => done()));
      const decoder = new PacketDecoder();
      let lines = '';
      let started = false;
      const timer = setTimeout(() => {
        // Startup already reports its deadline; a forced cleanup must not create
        // an unhandled rejection while the controller performs its own teardown.
        void this.stop().catch(() => {});
        reject(Error('音频设备启动超时。'));
      }, 8000);
      child.stdout.on('data', (b) => {
        try {
          for (const p of decoder.push(b)) this.audio(p);
        } catch {
          this.failure('音频数据包损坏，采集已停止。');
        }
      });
      child.stderr.on('data', (b) => {
        lines += b;
        let at;
        while ((at = lines.indexOf('\n')) >= 0) {
          const line = lines.slice(0, at);
          lines = lines.slice(at + 1);
          try {
            const m = JSON.parse(line);
            if (m.type === 'started') {
              started = true;
              clearTimeout(timer);
              resolve();
            }
            if (m.type === 'error') {
              const message = `${this.source === 'system' ? '系统音频' : '麦克风'}不可用（${m.code}），请检查设备、隐私权限或默认设备变化后重新开始。`;
              if (!started) {
                clearTimeout(timer);
                reject(Error(message));
              } else if (!this.stopping) this.failure(message);
            }
          } catch {}
        }
      });
      child.on('error', () => {
        clearTimeout(timer);
        reject(Error('无法启动 Windows 音频采集助手。'));
      });
      child.on('exit', () => {
        clearTimeout(timer);
        if (!started) reject(Error('音频采集启动失败。'));
        else if (!this.stopping) this.failure('音频设备已断开或采集进程退出，请重新开始。');
      });
    });
  }
  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve, reject) => {
      let killed: NodeJS.Timeout | undefined;
      let forced = false;
      const timer = setTimeout(() => {
        forced = true;
        child.kill();
        killed = setTimeout(() => reject(Error('音频采集进程未能退出。')), 1000);
      }, 1500);
      void this.closed!.then(() => {
        clearTimeout(timer);
        clearTimeout(killed);
        if (forced) reject(Error('音频采集未能正常结束，末尾音频可能不完整。'));
        else if (child.exitCode !== 0) reject(Error('音频采集进程异常结束，请重新开始。'));
        else resolve();
      });
      if (child.exitCode === null) child.stdin.end();
    });
    this.child = undefined;
    this.closed = undefined;
  }
}

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
  private stopping = false;
  constructor(
    private helper: string,
    private source: AudioSource,
    private device: string | undefined,
    private audio: (p: AudioPacket) => void,
    private failure: (message: string) => void,
  ) {}
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.helper,
        [this.source, Buffer.from(this.device ?? '').toString('base64')],
        { windowsHide: true },
      );
      this.child = child;
      const decoder = new PacketDecoder();
      let lines = '';
      let started = false;
      const timer = setTimeout(() => {
        void this.stop();
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
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1500);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.exitCode !== null) {
        clearTimeout(timer);
        resolve();
      } else child.stdin.end();
    });
    this.child = undefined;
  }
}

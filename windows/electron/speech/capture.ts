import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AudioDevice, AudioSource } from '../../../shared/electron/contracts/speech';
import {
  BoundedLineDecoder,
  PacketDecoder,
  type AudioPacket,
} from '../../../shared/electron/backend/speech/buffer';

const retryableDeviceErrors = new Set([
  '0x88890004', // AUDCLNT_E_DEVICE_INVALIDATED
  '0x88890010', // AUDCLNT_E_SERVICE_NOT_RUNNING
  '0x88890026', // AUDCLNT_E_RESOURCES_INVALIDATED
  '0x80070490', // E_NOTFOUND when the default endpoint disappears
]);
const invalidControl = '音频采集助手输出异常，采集已停止；请重新开始。';
function hresult(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length === 10 && /^0x[0-9a-f]{8}$/i.test(value))
    return '0x' + value.slice(2).toUpperCase();
}

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
          const code = hresult(failure.code);
          if (code) return resolve({ ok: false, code: code.toUpperCase() });
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
    let failed = false;
    child.stdout.setEncoding('utf8');
    child.stderr.resume();
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
      reject(Error('读取音频设备超时。'));
    }, 5000);
    child.stdout.on('data', (b) => {
      if (failed) return;
      out += b;
      if (out.length > 100000) {
        failed = true;
        clearTimeout(timer);
        child.kill();
        reject(Error('Invalid device inventory'));
      }
    });
    child.on('error', () => {
      failed = true;
      clearTimeout(timer);
      reject(Error('音频采集助手缺失；请运行 pnpm build:audio。'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      try {
        if (code !== 0) throw Error();
        const inventory: unknown = JSON.parse(out);
        if (!Array.isArray(inventory) || inventory.length > 256) throw Error();
        resolve(inventory.map((device) => {
          if (
            !device || typeof device.id !== 'string' || !device.id || device.id.length > 512 ||
            typeof device.name !== 'string' || device.name.length > 2000 ||
            (device.source !== 'system' && device.source !== 'microphone') ||
            typeof device.default !== 'boolean'
          ) throw Error();
          const { id, name, source, default: isDefault } = device;
          return { id, name, source, default: isDefault };
        }));
      } catch {
        reject(Error('无法枚举 Windows 音频设备。'));
      }
    });
  });
}
export class WasapiCapture {
  private child?: ChildProcessWithoutNullStreams;
  private closed?: Promise<boolean>;
  private stopping?: 'stop' | 'recover';
  private nativeClosed = false;
  private fault?: 'recoverable' | Error;
  private stopTask?: Promise<void>;
  get retiring() {
    return !!this.stopping && !!this.child && !this.nativeClosed;
  }
  get terminalError() {
    return this.fault instanceof Error ? this.fault : undefined;
  }
  constructor(
    private helper: string,
    private source: AudioSource,
    private device: string | undefined,
    private audio: (p: AudioPacket) => void,
    private failure: (message: string, recoverable?: boolean) => void,
  ) {}
  start(): Promise<void> {
    if (this.stopTask || (this.child && !this.nativeClosed))
      return Promise.reject(Error('旧音频采集进程尚未退出，请稍后重试。'));
    this.stopping = undefined;
    this.nativeClosed = false;
    this.fault = undefined;
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.helper,
        [this.source, Buffer.from(this.device ?? '').toString('base64')],
        { windowsHide: true },
      );
      this.child = child;
      const decoder = new PacketDecoder();
      const lines = new BoundedLineDecoder(16384);
      let started = false;
      let failed = false;
      let audioDamaged = false;
      let exitTimer: ReturnType<typeof setTimeout> | undefined;
      const fail = (message: string, recoverable = false) => {
        if (this.child !== child || this.stopping === 'stop') return;
        const fault = recoverable ? 'recoverable' : Error(message);
        if (this.stopping === 'recover') {
          // Both endpoints can fail together. Keep the second endpoint's own
          // diagnosis during teardown, without dispatching another restart.
          if (!this.terminalError) this.fault = fault;
          return;
        }
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        clearTimeout(exitTimer);
        if (started) {
          this.fault = fault;
          this.failure(message, recoverable);
        } else reject(Error(message));
      };
      const timer = setTimeout(() => {
        reject(Error('音频设备启动超时。'));
        failed = true;
        void this.stop().catch(() => {});
      }, 8000);
      const invalid = () => {
        fail(invalidControl);
        if (!this.nativeClosed) child.kill();
      };
      const control = (line: string) => {
        if (!line || this.stopping === 'stop' || (failed && this.stopping !== 'recover')) return;
        let status;
        try {
          status = JSON.parse(line);
        } catch {
          return invalid();
        }
        if (status?.type === 'stopped' && this.stopping === 'recover') return;
        if (status?.type === 'started' && !started && !this.stopping) {
          started = true;
          clearTimeout(timer);
          resolve();
        } else if (status?.type === 'error') {
          const code = hresult(status.code);
          if (!code) return invalid();
          const message = `${this.source === 'system' ? '系统音频' : '麦克风'}不可用（${code}），请检查设备、隐私权限或默认设备变化后重新开始。`;
          fail(message, retryableDeviceErrors.has(code));
        } else invalid();
      };
      const audioError = () => {
        if (audioDamaged || this.child !== child || this.nativeClosed) return;
        audioDamaged = true;
        fail('音频数据包损坏，采集已停止。');
        child.kill();
      };
      child.stdout.on('data', (b) => {
        if (failed || audioDamaged || this.child !== child || this.nativeClosed) return;
        try {
          for (const p of decoder.push(b)) this.audio(p);
        } catch {
          audioError();
        }
      });
      child.stderr.on('data', (b) => {
        if (this.child !== child || this.nativeClosed) return;
        if (failed && this.stopping !== 'recover') return;
        try {
          for (const line of lines.push(b)) control(line);
        } catch {
          invalid();
        }
      });
      child.on('error', () => fail('无法启动 Windows 音频采集助手。'));
      child.stdout.on('error', audioError);
      child.stderr.on('error', () => fail(invalidControl));
      const waitForClose = () => {
        if (this.child !== child || this.nativeClosed || failed || this.stopping || exitTimer) return;
        exitTimer = setTimeout(() => fail('旧音频采集进程尚未退出，请稍后重试。'), 5000);
      };
      // An exit or broken stdin can precede a permission error in the last stderr bytes.
      child.on('exit', waitForClose);
      child.stdin.on('error', () => {
        if (this.child !== child || this.nativeClosed) return;
        if (this.stopping === 'stop') child.kill();
        else waitForClose();
      });
      this.closed = new Promise((done) => child.once('close', () => {
        this.nativeClosed = true;
        control(lines.finish());
        clearTimeout(timer);
        clearTimeout(exitTimer);
        if (!started) reject(Error('音频采集启动失败。'));
        else if (!this.stopping) fail('音频设备已断开或采集进程退出，请重新开始。', true);
        done(!audioDamaged && !decoder.hasPartialPacket);
      }));
    });
  }
  stop(intent?: 'recover'): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopping = intent ?? 'stop';
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopTask = new Promise<void>((resolve, reject) => {
      let killed: NodeJS.Timeout | undefined;
      let forced = false;
      const timer = setTimeout(() => {
        forced = true;
        killed = setTimeout(() => reject(Error('音频采集进程未能退出。')), 1000);
        child.kill();
      }, 1500);
      void this.closed!.then((completeAudio) => {
        clearTimeout(timer);
        clearTimeout(killed);
        if (forced) reject(Error('音频采集未能正常结束，末尾音频可能不完整。'));
        else if (this.stopping === 'recover' && this.terminalError) reject(this.terminalError);
        else if (!completeAudio && this.fault !== 'recoverable')
          reject(Error('音频采集未能正常结束，末尾音频可能不完整。'));
        // The reported device/helper loss already ended this stream abnormally.
        // Recovery may proceed only now that both output pipes have closed.
        else if (child.exitCode !== 0 && this.fault !== 'recoverable')
          reject(Error('音频采集进程异常结束，请重新开始。'));
        else resolve();
      });
      if (child.exitCode === null) child.stdin.end();
    }).finally(() => {
      this.stopTask = undefined;
      if (this.nativeClosed) {
        this.child = undefined;
        this.closed = undefined;
      }
    });
    return this.stopTask;
  }
}

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AudioDevice, AudioSource } from '../../../shared/electron/contracts/speech';
import { BoundedLineDecoder, PacketDecoder, type AudioPacket } from '../../../shared/electron/backend/speech/buffer';

export function captureError(code?: string) {
  if (code === 'permission-denied')
    return '音频权限未开启，请在 macOS 隐私与安全性设置中允许 VoxCue 访问麦克风或录制系统音频后重试。';
  if (code === 'device-unavailable') return '所选音频设备已断开，请刷新并重新选择设备。';
  if (code === 'unsupported-audio-format-or-layout')
    return '所选音频设备的采样格式或首选声道布局暂不受支持，请检查设备设置或选择其他设备。';
  if (code === 'device-changed') return '音频设备或采样率已变化，请检查设备后重新连接。';
  if (code === 'drain-failed') return '音频采集未能正常结束，末尾音频可能不完整。';
  if (code === 'device-changed-or-backpressure')
    return '音频设备、采样率或默认设备已变化，或采集积压超限；采集已停止，请检查设备后重新开始。';
  return 'macOS 音频设备无法初始化，请检查设备和隐私权限后重试。';
}
export function devices(helper: string): Promise<AudioDevice[]> {
  return new Promise((resolve, reject) => {
    execFile(helper, ['devices'], { timeout: 10000, maxBuffer: 100000 }, (error, stdout) => {
      try {
        if (error) throw error;
        const values: unknown = JSON.parse(stdout);
        if (
          !Array.isArray(values) ||
          values.length > 256 ||
          values.some(
            (d) =>
              !d ||
              typeof d.id !== 'string' ||
              !d.id ||
              d.id.length > 2000 ||
              typeof d.name !== 'string' ||
              d.name.length > 2000 ||
              !['system', 'microphone'].includes(d.source) ||
              typeof d.default !== 'boolean',
          )
        )
          throw Error();
        resolve(values);
      } catch {
        reject(Error('无法读取 Mac 音频设备；请检查连接并运行 pnpm build:audio。'));
      }
    });
  });
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
      { timeout: 100000, maxBuffer: 10000 },
      (error, stdout, stderr) => {
        try {
          const value = JSON.parse(error ? stderr.trim() : stdout);
          if (!error && value.ok === true && value.samplesRead === 0) return resolve({ ok: true });
          if (typeof value.code === 'string' && /^[a-z-]{1,60}$/.test(value.code))
            return resolve({ ok: false, code: value.code });
        } catch {
          /* Missing/malformed native output fails closed. */
        }
        resolve({ ok: false });
      },
    );
  });
}
export class CoreAudioCapture {
  private child?: ChildProcessWithoutNullStreams;
  private stopping?: 'stop' | 'recover';
  private fault?: Error;
  get terminalError() { return this.fault; }
  private closed = false;
  private stopTask?: Promise<void>;
  get retiring() {
    return !!this.stopping && !!this.child && !this.closed;
  }
  get retired() {
    return this.closed;
  }
  constructor(
    private helper: string,
    private source: AudioSource,
    private device: string | undefined,
    private audio: (packet: AudioPacket) => void,
    private failure: (message: string, recoverable?: boolean) => void,
    private audioLost?: () => void,
  ) {}
  start(): Promise<void> {
    if (this.stopTask || (this.child && !this.closed))
      return Promise.reject(Error('旧音频采集进程尚未退出，请稍后重试。'));
    this.stopping = undefined;
    this.fault = undefined;
    this.closed = false;
    return new Promise((resolve, reject) => {
      const child = spawn(this.helper, [
        this.source,
        Buffer.from(this.device ?? '').toString('base64'),
      ]);
      this.child = child;
      const decoder = new PacketDecoder();
      const lines = new BoundedLineDecoder(10000);
      let started = false;
      let reported = false;
      let exitTimer: ReturnType<typeof setTimeout> | undefined;
      const fail = (message: string, recoverable = false) => {
        if (this.child !== child) return;
        if (!recoverable) this.fault ??= Error(message);
        if (reported || this.stopping) return;
        reported = true;
        clearTimeout(timer);
        clearTimeout(exitTimer);
        if (started) this.failure(message, recoverable);
        else reject(Error(message));
        if (!recoverable && !this.closed) void this.stop().catch(() => {});
      };
      const timer = setTimeout(
        () => fail('Mac 音频启动超时，请确认系统权限提示后重新开始。'),
        100000,
      );
      const control = (line: string) => {
        if (!line) return;
        const value = JSON.parse(line);
        if (value.type === 'started' && !started && !this.stopping && !reported) {
          started = true;
          clearTimeout(timer);
          resolve();
        } else if (value.type === 'error' && typeof value.code === 'string') {
          // After startup, these diagnostics mean the PCM writer or conversion lost data.
          // A clean device change drains its last packets and uses a separate diagnostic.
          if (started && (value.code === 'device-changed-or-backpressure' || value.code === 'drain-failed'))
            this.audioLost?.();
          fail(captureError(value.code), started && value.code === 'device-changed');
        } else throw Error('Invalid control record');
      };
      const invalidControl = () => fail('原生音频控制消息无效，采集已停止。');
      const invalidAudio = () => {
        if (started && this.child === child) this.audioLost?.();
        fail('原生音频数据无效，采集已停止。');
      };
      child.stdout.on('data', (chunk) => {
        if (this.fault || this.child !== child || this.closed) return;
        try {
          for (const packet of decoder.push(chunk)) this.audio(packet);
        } catch {
          invalidAudio();
        }
      });
      child.stderr.on('data', (chunk) => {
        if (this.child !== child || this.closed) return;
        try {
          for (const line of lines.push(chunk)) control(line);
        } catch {
          invalidControl();
        }
      });
      child.stdout.on('error', invalidAudio);
      child.stderr.on('error', invalidControl);
      child.on('error', () => fail('无法启动 Mac 音频助手，请运行 pnpm build:audio。'));
      child.stdin.on('error', () => fail('Mac 音频助手管道已关闭，请重新开始。'));
      child.on('close', (code) => {
        if (this.child !== child) return;
        this.closed = true;
        clearTimeout(timer);
        clearTimeout(exitTimer);
        try { control(lines.finish()); } catch { invalidControl(); }
        if (decoder.hasPartialPacket) invalidAudio();
        if (!started) reject(Error('Mac 音频采集已取消或启动失败。'));
        else if (!this.stopping) fail('原生音频进程已退出，采集已释放；请重新开始。', true);
        else if (this.stopping === 'stop' && code !== 0 && !reported)
          fail('音频采集未能正常结束，末尾音频可能不完整。');
      });
      child.on('exit', () => {
        // Drain stderr before classifying an unexplained process loss.
        // An exit with inherited pipes still open must not remove the startup
        // watchdog or leave an already-running capture silently stuck forever.
        if (started && !this.stopping && !reported)
          exitTimer = setTimeout(() => fail('Mac 音频采集进程尚未确认退出，请稍后重试。'), 5000);
      });
    });
  }
  stop(intent?: 'recover'): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopping = intent ?? 'stop';
    const priorFault = this.fault;
    const child = this.child;
    if (!child) return Promise.resolve();
    if (this.closed) {
      this.child = undefined;
      return intent === 'recover' && this.fault ? Promise.reject(this.fault) : Promise.resolve();
    }
    this.stopTask = new Promise<void>((resolve, reject) => {
      let forced = false;
      const finish = (error?: Error) => {
        clearTimeout(terminate);
        clearTimeout(force);
        clearTimeout(deadline);
        child.removeListener('close', close);
        if (error) reject(error);
        else resolve();
      };
      const close = () => {
        if (this.child === child) this.child = undefined;
        if (forced) finish(Error('Mac 音频采集被强制停止，请重新开始。'));
        else finish(intent === 'recover' || this.fault !== priorFault ? this.fault : undefined);
      };
      const kill = (signal: NodeJS.Signals) => {
        forced = true;
        // Sending a signal (including success=true) never proves process retirement.
        try {
          child.kill(signal);
        } catch {
          /* Deadline reports unconfirmed close. */
        }
      };
      const terminate = setTimeout(() => kill('SIGTERM'), 1500);
      const force = setTimeout(() => kill('SIGKILL'), 2500);
      const deadline = setTimeout(
        () => finish(Error('Mac 音频采集进程尚未确认退出，请稍后重试。')),
        5000,
      );
      child.once('close', close);
      try {
        child.stdin.end();
      } catch {
        kill('SIGKILL');
      }
    }).finally(() => {
      this.stopTask = undefined;
    });
    return this.stopTask;
  }
}

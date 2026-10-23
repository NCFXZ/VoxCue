import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AudioDevice, AudioSource } from '../../../shared/electron/contracts/speech';
import { PacketDecoder, type AudioPacket } from '../../../shared/electron/backend/speech/buffer';

export function captureError(code?: string) {
  if (code === 'permission-denied')
    return '音频权限未开启，请在 macOS 隐私与安全性设置中允许 VoxCue 访问麦克风或录制系统音频后重试。';
  if (code === 'device-unavailable') return '所选音频设备已断开，请刷新并重新选择设备。';
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
  private stopping = false;
  private closed = false;
  constructor(
    private helper: string,
    private source: AudioSource,
    private device: string | undefined,
    private audio: (packet: AudioPacket) => void,
    private failure: (message: string) => void,
  ) {}
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.helper, [
        this.source,
        Buffer.from(this.device ?? '').toString('base64'),
      ]);
      this.child = child;
      const decoder = new PacketDecoder();
      let started = false,
        lines = '',
        failed = false;
      const fail = (message: string) => {
        if (failed || this.stopping) return;
        failed = true;
        clearTimeout(timer);
        if (started) this.failure(message);
        else reject(Error(message));
        void this.stop();
      };
      const timer = setTimeout(
        () => fail('Mac 音频启动超时，请确认系统权限提示后重新开始。'),
        100000,
      );
      child.stdout.on('data', (chunk) => {
        if (failed) return;
        try {
          for (const packet of decoder.push(chunk)) this.audio(packet);
        } catch {
          fail('原生音频数据无效，采集已停止。');
        }
      });
      child.stderr.on('data', (chunk) => {
        lines += chunk;
        if (lines.length > 10000) return fail('原生音频控制消息超限，采集已停止。');
        let at: number;
        while ((at = lines.indexOf('\n')) >= 0) {
          const line = lines.slice(0, at);
          lines = lines.slice(at + 1);
          try {
            const value = JSON.parse(line);
            if (value.type === 'started' && !started && !this.stopping && !failed) {
              started = true;
              clearTimeout(timer);
              resolve();
            } else if (value.type === 'error') fail(captureError(value.code));
          } catch {
            if (line.startsWith('{')) fail('原生音频控制消息无效，采集已停止。');
          }
        }
      });
      child.on('error', () => fail('无法启动 Mac 音频助手，请运行 pnpm build:audio。'));
      child.on('close', () => {
        this.closed = true;
      });
      child.on('exit', () => {
        clearTimeout(timer);
        if (!started) reject(Error('Mac 音频采集已取消或启动失败。'));
        else if (!this.stopping) fail('原生音频进程已退出，采集已释放；请重新开始。');
      });
    });
  }
  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      if (this.closed) return resolve();
      const timer = setTimeout(() => child.kill(), 1500);
      const force = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2500);
      child.once('close', () => {
        clearTimeout(timer);
        clearTimeout(force);
        resolve();
      });
      child.stdin.on('error', () => {});
      child.stdin.end();
    });
    this.child = undefined;
  }
}

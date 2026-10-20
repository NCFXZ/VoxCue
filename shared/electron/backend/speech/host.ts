import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import type { SpeechServiceCall, SpeechEvent, SpeechStatus } from '../../contracts/speech';
export class SpeechHost {
  private child?: UtilityProcess;
  private ready?: Promise<any>;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(
    private model: string,
    private helper: string | undefined,
    private emit: (e: SpeechEvent) => void,
    private processFile?: string,
    private qwenDirectory?: string,
    private qwenRuntime?: string,
  ) {}
  private send(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(Error('本地语音服务超时。'));
          if (data.call?.op === 'switch-recognizer') {
            try {
              this.child?.postMessage({ id: randomUUID(), call: { op: 'cancel-switch' } });
            } catch {
              /* A closed port already rejects its pending calls. */
            }
          } else this.stop();
        },
        data.call?.op === 'switch-recognizer' ? 310000 : this.qwenDirectory ? 200000 : 70000,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child!.postMessage({ id, ...data });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private start() {
    if (this.ready) return this.ready;
    const child = utilityProcess.fork(
      this.processFile!.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
      [],
      { serviceName: 'VoxCue 本地语音', stdio: 'pipe' },
    );
    this.child = child;
    child.on('message', (m) => {
      if (this.child !== child) return;
      if (m.event) this.emit(m.event);
      const p = this.pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        m.error ? p.reject(Error(m.error)) : p.resolve(m.value);
      }
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.ready = undefined;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error('本地语音服务已退出。'));
      }
      this.pending.clear();
      this.emit({
        type: 'status',
        status: {
          state: 'error',
          model: 'Paraformer · Silero',
          error: '语音服务已退出，采集已释放；请重新开始。',
        },
      });
    });
    this.ready = this.send({
      init: true,
      model: this.model,
      helper: this.helper,
      qwenDirectory: this.qwenDirectory,
      qwenRuntime: this.qwenRuntime,
    });
    return this.ready;
  }
  async call(call: SpeechServiceCall): Promise<SpeechStatus> {
    if (!this.helper || !this.processFile) throw Error('当前系统尚未支持本地音频采集。');
    await this.start();
    return this.send({ call });
  }
  stop() {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    child?.kill();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error('语音服务已关闭。'));
    }
    this.pending.clear();
  }
  async close() {
    const child = this.child;
    if (!child) return;
    if (this.qwenDirectory) await this.send({ close: true });
    await new Promise<void>((resolve, reject) => {
      const exited = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.removeListener('exit', exited);
        reject(Error('本地语音进程尚未退出，请稍后重试。'));
      }, 10000);
      child.once('exit', exited);
      this.stop();
    });
  }
}

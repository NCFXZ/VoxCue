import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import type { SpeechServiceCall, SpeechEvent, SpeechStatus } from '../../contracts/speech';
import { speechModelLabels } from '../../contracts/speechSettings';
export class SpeechHost {
  private child?: UtilityProcess;
  private ready?: Promise<any>;
  private retiring?: Promise<void>;
  private recordingChild?: UtilityProcess;
  private closingRecording?: Promise<void>;
  private lostCaptureTail = false;
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
          if (data.call?.op === 'switch-recognizer' || data.call?.op === 'set-input-state') {
            try {
              this.child?.postMessage({
                id: randomUUID(),
                call: {
                  op: data.call.op === 'set-input-state' ? 'cancel-input-state' : 'cancel-switch',
                },
              });
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
  private start(): Promise<any> {
    if (this.retiring) return this.waitForRetirement().then(() => this.start());
    if (this.ready) return this.ready;
    const child = utilityProcess.fork(
      this.processFile!.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
      [],
      { serviceName: 'VoxCue 本地语音', stdio: 'pipe' },
    );
    this.child = child;
    // Native dependencies may write diagnostics; drain without exposing audio or paths.
    child.stdout?.resume();
    child.stderr?.resume();
    let model: string = speechModelLabels.paraformer;
    let capturing = false;
    child.on('message', (m) => {
      if (this.child !== child) return;
      if (m.event?.type === 'status') {
        const status = m.event.status;
        model = status.model;
        if (status.state === 'running') {
          capturing = true;
        } else if (status.state === 'idle' || status.state === 'paused') capturing = false;
      }
      if (m.event?.type === 'recording')
        this.recordingChild = m.event.active || m.event.draining ? child : undefined;
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
      if (capturing) this.lostCaptureTail = true;
      this.child = undefined;
      this.recordingChild = undefined;
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
          model,
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
    if (call.op === 'recording' && call.directory) this.recordingChild = this.child;
    if (call.op !== 'stop') return this.send({ call });
    try {
      const result: SpeechStatus = await this.send({ call });
      return this.lostCaptureTail ? { ...result, transcriptTailIncomplete: true } : result;
    } finally {
      this.lostCaptureTail = false;
    }
  }
  stop() {
    this.lostCaptureTail = false;
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.ready = undefined;
    const pending = this.pending;
    this.pending = new Map();
    for (const p of pending.values()) clearTimeout(p.timer);
    const settle = (message: string) => {
      for (const p of pending.values()) p.reject(Error(message));
      pending.clear();
    };
    // A stuck OS process keeps its retirement fence, but cannot leave IPC callers hanging.
    const timer = pending.size
      ? setTimeout(() => settle('本地语音进程尚未退出，请稍后重试。'), 10000)
      : undefined;
    const retired = new Promise<void>((resolve) => {
      child.once('exit', () => {
        clearTimeout(timer);
        settle('语音服务已关闭。');
        resolve();
      });
    });
    this.retiring = retired;
    void retired.then(() => {
      if (this.retiring === retired) this.retiring = undefined;
    });
    const kill = () => {
      try { child.kill(); } catch { /* Ownership is released only by actual exit. */ }
    };
    if (this.recordingChild !== child) {
      kill();
      return;
    }
    // Window teardown can race the renderer's normal end/flush. Give the old
    // utility a bounded opportunity to commit its final mixing window.
    this.recordingChild = undefined;
    this.closingRecording = retired;
    const id = randomUUID();
    const finish = () => {
      clearTimeout(deadline);
      child.removeListener('message', acknowledge);
      kill();
    };
    const acknowledge = (message: { id?: string }) => { if (message.id === id) finish(); };
    const deadline = setTimeout(finish, 1500);
    child.on('message', acknowledge);
    void retired.then(() => {
      clearTimeout(deadline);
      child.removeListener('message', acknowledge);
      if (this.closingRecording === retired) this.closingRecording = undefined;
    });
    try { child.postMessage({ id, call: { op: 'recording' } }); } catch { finish(); }
  }
  async finishRecording() {
    if (this.recordingChild) this.stop();
    if (this.closingRecording) await this.waitForRetirement();
  }
  private async waitForRetirement() {
    if (!this.retiring) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.retiring,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(Error('本地语音进程尚未退出，请稍后重试。')),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async close() {
    const child = this.child;
    try {
      if (child && this.qwenDirectory) await this.send({ close: true });
    } finally {
      if (this.child === child) this.stop();
      await this.waitForRetirement();
    }
  }
}

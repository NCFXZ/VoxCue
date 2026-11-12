import { execFile } from 'node:child_process';
import path from 'node:path';
import type { SpeechHardware, SpeechOptions } from '../../contracts/speech';
import { cudaUnavailableMessage, speechSelection } from '../../contracts/speechSettings';

/** Driver/device inventory only: no model download, audio permission or capture. */
export class SpeechHardwareProbe {
  private pending?: Promise<SpeechHardware>;
  private cpuPending?: Promise<Pick<SpeechHardware, 'qwenCpu' | 'qwenCpuReason'>>;
  constructor(
    private helper?: string,
    private platform: NodeJS.Platform = process.platform,
    private macRuntime?: string,
  ) {}
  read(): Promise<SpeechHardware> {
    if (this.platform === 'darwin' && this.macRuntime) {
      if (this.pending) return this.pending;
      const pending = new Promise<SpeechHardware>((resolve) => {
        execFile(
          this.macRuntime!,
          ['metal-check'],
          { timeout: 5000, maxBuffer: 4096 },
          (error, stdout) => {
            try {
              const value = JSON.parse(stdout);
              if (!error && typeof value.metal === 'boolean') {
                resolve({ cuda: false, metal: value.metal });
                return;
              }
            } catch {
              /* Fail closed without touching models or capture. */
            }
            resolve({ cuda: false, metal: false, reason: 'unavailable' });
          },
        );
      });
      this.pending = pending;
      void pending.finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
      return pending;
    }
    if (this.platform !== 'win32') return Promise.resolve({ cuda: false, reason: 'platform' });
    if (!this.helper) return Promise.resolve({ cuda: false, reason: 'unavailable' });
    if (this.pending) return this.pending;
    const cuda = new Promise<SpeechHardware>((resolve) => {
      execFile(
        this.helper!,
        ['cuda-check'],
        { windowsHide: true, timeout: 5000, maxBuffer: 4096 },
        (error, stdout) => {
          try {
            const value = JSON.parse(stdout);
            if (
              !error &&
              typeof value.cuda === 'boolean' &&
              (value.cuda ||
                ['unsupported-gpu', 'driver-unavailable', 'driver-outdated'].includes(value.reason))
            ) {
              resolve(value.cuda ? { cuda: true } : { cuda: false, reason: value.reason });
              return;
            }
          } catch {
            /* Missing, stale or malformed helper output fails closed. */
          }
          resolve({ cuda: false, reason: 'unavailable' });
        },
      );
    });
    const pending = Promise.all([cuda, this.cpu()]).then(([gpu, cpu]) => ({ ...gpu, ...cpu }));
    this.pending = pending;
    void pending.finally(() => {
      if (this.pending === pending) this.pending = undefined;
    });
    return pending;
  }
  private cpu(): Promise<Pick<SpeechHardware, 'qwenCpu' | 'qwenCpuReason'>> {
    if (this.cpuPending) return this.cpuPending;
    const pending = new Promise<Pick<SpeechHardware, 'qwenCpu' | 'qwenCpuReason'>>((resolve) => {
      if (!this.helper) {
        resolve({ qwenCpu: false, qwenCpuReason: 'unavailable' });
        return;
      }
      execFile(
        path.join(path.dirname(this.helper), 'VoxCue.Cpu.exe'),
        [],
        { windowsHide: true, timeout: 5000, maxBuffer: 4096 },
        (error, stdout) => {
          try {
            const value = JSON.parse(stdout);
            if (!error && typeof value.qwenCpu === 'boolean') {
              resolve(value.qwenCpu
                ? { qwenCpu: true }
                : { qwenCpu: false, qwenCpuReason: 'unsupported-cpu' });
              return;
            }
          } catch {
            /* The owned helper must explicitly confirm both CPU features. */
          }
          resolve({ qwenCpu: false, qwenCpuReason: 'unavailable' });
        },
      );
    });
    this.cpuPending = pending;
    void pending.finally(() => {
      if (this.cpuPending === pending) this.cpuPending = undefined;
    });
    return pending;
  }
  async require(options: SpeechOptions) {
    const selected = speechSelection(options);
    if (selected.speechModel !== 'qwen') return;
    if (selected.inferenceDevice === 'metal') {
      if (this.platform !== 'darwin' || !(await this.read()).metal)
        throw Error('Metal 推理设备不可用，请选择 CPU。');
      return;
    }
    let hardware: SpeechHardware | undefined;
    if (this.platform === 'win32') {
      hardware = selected.inferenceDevice === 'cpu'
        ? { cuda: false, ...await this.cpu() }
        : await this.read();
      if (!hardware.qwenCpu)
        throw Error(hardware.qwenCpuReason === 'unsupported-cpu'
          ? 'Qwen 需要支持 AVX2 和 FMA 的处理器，请改用 Paraformer。'
          : '无法确认 Qwen 所需的处理器指令集，请改用 Paraformer。');
    }
    if (selected.inferenceDevice === 'cpu') return;
    hardware ??= await this.read();
    if (!hardware.cuda) throw Error(cudaUnavailableMessage(hardware));
  }
}

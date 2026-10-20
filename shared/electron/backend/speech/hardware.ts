import { execFile } from 'node:child_process';
import type { SpeechHardware, SpeechOptions } from '../../contracts/speech';
import { cudaUnavailableMessage, speechSelection } from '../../contracts/speechSettings';

/** Driver/device inventory only: no model download, audio permission or capture. */
export class SpeechHardwareProbe {
  private pending?: Promise<SpeechHardware>;
  constructor(
    private helper?: string,
    private platform: NodeJS.Platform = process.platform,
  ) {}
  read(): Promise<SpeechHardware> {
    if (this.platform !== 'win32') return Promise.resolve({ cuda: false, reason: 'platform' });
    if (!this.helper) return Promise.resolve({ cuda: false, reason: 'unavailable' });
    if (this.pending) return this.pending;
    const pending = new Promise<SpeechHardware>((resolve) => {
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
    this.pending = pending;
    void pending.finally(() => {
      if (this.pending === pending) this.pending = undefined;
    });
    return pending;
  }
  async require(options: SpeechOptions) {
    const selected = speechSelection(options);
    if (selected.speechModel !== 'qwen' || selected.inferenceDevice !== 'cuda') return;
    const hardware = await this.read();
    if (!hardware.cuda) throw Error(cudaUnavailableMessage(hardware));
  }
}

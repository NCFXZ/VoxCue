import { SpeechController as SharedSpeechController } from '../../../shared/electron/backend/speech/controller';
import path from 'node:path';
import type { AudioSource, SpeechEvent } from '../../../shared/electron/contracts/speech';
import { WasapiCapture, devices } from './capture';
export { speechModelName } from '../../../shared/electron/backend/speech/controller';
export class SpeechController extends SharedSpeechController {
  constructor(
    model: string,
    helper: string,
    emit: (event: SpeechEvent) => void,
    qwenDirectory?: string,
  ) {
    const captures = new Map<AudioSource, WasapiCapture>();
    super(
      model,
      helper,
      emit,
      {
        // WASAPI timestamps and libuv's Windows high-resolution clock both use QPC.
        captureClockNow: () => Number(process.hrtime.bigint()) / 1e6,
        drainBeforeRetire: true,
        automaticRestart: true,
        preprocessorFile: path.join(__dirname, 'echoCancellation.js'),
        devices,
        create: (helper, source, device, audio, failure) => {
          for (const capture of captures.values()) {
            if (capture.retiring) throw Error('旧音频采集进程尚未退出，请稍后重试。');
          }
          const capture = new WasapiCapture(helper, source, device, audio, failure);
          captures.set(source, capture);
          return capture;
        },
      },
      qwenDirectory,
    );
  }
}

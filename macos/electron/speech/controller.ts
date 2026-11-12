import { SpeechController as SharedSpeechController } from '../../../shared/electron/backend/speech/controller';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
import { CoreAudioCapture, devices } from './capture';
import path from 'node:path';
export class SpeechController extends SharedSpeechController {
  constructor(
    model: string,
    helper: string,
    emit: (event: SpeechEvent) => void,
    qwenDirectory?: string,
    qwenRuntime?: string,
  ) {
    const captures = new Set<CoreAudioCapture>();
    super(
      model,
      helper,
      emit,
      {
        drainBeforeRetire: true,
        qwenRuntime,
        preprocessorFile: path.join(__dirname, 'echoCancellation.js'),
        devices,
        create: (...args) => {
          for (const capture of captures) {
            if (capture.retiring) throw Error('旧音频采集进程尚未退出，请稍后重试。');
            if (capture.retired) captures.delete(capture);
          }
          const capture = new CoreAudioCapture(...args);
          captures.add(capture);
          return capture;
        },
      },
      qwenDirectory,
    );
  }
}

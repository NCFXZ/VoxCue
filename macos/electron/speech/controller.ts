import { SpeechController as SharedSpeechController } from '../../../shared/electron/backend/speech/controller';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
import { CoreAudioCapture, devices } from './capture';
import path from 'node:path';
export class SpeechController extends SharedSpeechController {
  constructor(model: string, helper: string, emit: (event: SpeechEvent) => void) {
    super(model, helper, emit, {
      drainBeforeRetire: true,
      preprocessorFile: path.join(__dirname, 'echoCancellation.js'),
      devices,
      create: (...args) => new CoreAudioCapture(...args),
    });
  }
}

import { SpeechController as SharedSpeechController } from '../../../shared/electron/backend/speech/controller';
import path from 'node:path';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
import { WasapiCapture, devices } from './capture';
export { speechModelName } from '../../../shared/electron/backend/speech/controller';
export class SpeechController extends SharedSpeechController {
  constructor(model: string, helper: string, emit: (event: SpeechEvent) => void) {
    super(model, helper, emit, {
      drainBeforeRetire: true,
      preprocessorFile: path.join(__dirname, 'echoCancellation.js'),
      devices,
      create: (...args) => new WasapiCapture(...args),
    });
  }
}

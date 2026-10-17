import { SpeechController as SharedSpeechController } from '../../../shared/electron/backend/speech/controller';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
import { WasapiCapture, devices } from './capture';
export { speechModelName } from '../../../shared/electron/backend/speech/controller';
export class SpeechController extends SharedSpeechController {
  constructor(model: string, helper: string, emit: (event: SpeechEvent) => void) {
    super(model, helper, emit, { devices, create: (...args) => new WasapiCapture(...args) });
  }
}

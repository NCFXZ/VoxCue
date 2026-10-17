import type {
  AudioDevice,
  AudioSource,
  InterviewAccessCheck,
  InterviewAccessReport,
  SpeechOptions,
} from '../../../shared/electron/contracts/speech';
import { validateSpeech } from '../../../shared/electron/backend/speech/validation';
import { captureError } from './capture';
interface Dependencies {
  devices(): Promise<AudioDevice[]>;
  probe(source: AudioSource, device?: string): Promise<{ ok: boolean; code?: string }>;
}
export class InterviewAccess {
  constructor(private dependencies: Dependencies) {}
  async check(value: SpeechOptions): Promise<InterviewAccessReport> {
    const call = validateSpeech({ op: 'start', options: value });
    if (call.op !== 'start' || !call.options.sources.includes('system'))
      throw Error('面试需要系统音频。');
    let devices: AudioDevice[];
    try {
      devices = await this.dependencies.devices();
    } catch {
      return {
        ready: false,
        devices: [],
        checks: call.options.sources.map((source) => ({
          source,
          status: 'error',
          message: '无法读取 Mac 音频设备，请检查连接后重试。',
        })),
      };
    }
    const checks: InterviewAccessCheck[] = [];
    // Permission prompts are serialized, and a disabled microphone is never touched.
    for (const source of call.options.sources) {
      const selected = call.options[source];
      if (!devices.some((d) => d.source === source && (selected ? d.id === selected : d.default))) {
        checks.push({
          source,
          status: 'unavailable',
          message: `所选${source === 'system' ? '系统音频' : '麦克风'}设备不可用，请重新选择。`,
        });
        continue;
      }
      try {
        const result = await this.dependencies.probe(source, selected);
        checks.push(
          result.ok
            ? {
                source,
                status: 'granted',
                message: `${source === 'system' ? '系统音频' : '麦克风'}可用`,
              }
            : {
                source,
                status: result.code === 'permission-denied' ? 'denied' : 'error',
                message: captureError(result.code),
              },
        );
      } catch {
        checks.push({ source, status: 'error', message: 'Mac 音频权限检查失败，请重新检查。' });
      }
    }
    return { ready: checks.every((check) => check.status === 'granted'), devices, checks };
  }
}

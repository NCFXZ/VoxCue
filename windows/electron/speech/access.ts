import type {
  AudioDevice,
  AudioSource,
  InterviewAccessCheck,
  InterviewAccessReport,
  SpeechOptions,
} from '../../../shared/electron/contracts/speech';
import { validateSpeech } from '../../../shared/electron/backend/speech/validation';

interface Dependencies {
  platform: string;
  microphonePermission(): string;
  devices(): Promise<AudioDevice[]>;
  probe(source: AudioSource, device?: string): Promise<{ ok: boolean; code?: string }>;
}
export class InterviewAccess {
  constructor(private dependencies: Dependencies) {}
  async check(value: SpeechOptions): Promise<InterviewAccessReport> {
    const call = validateSpeech({ op: 'start', options: value });
    if (call.op !== 'start' || !call.options.sources.includes('system'))
      throw Error('面试需要系统音频。');
    const options = call.options;
    let devices: AudioDevice[];
    try {
      if (this.dependencies.platform !== 'win32') throw Error('Unsupported platform');
      devices = await this.dependencies.devices();
    } catch {
      return {
        ready: false,
        devices: [],
        checks: options.sources.map((source) => ({
          source,
          status: 'error',
          message: '无法检查音频设备，请检查设备连接后重新检查。',
        })),
      };
    }
    const checks = await Promise.all(
      options.sources.map(async (source): Promise<InterviewAccessCheck> => {
        const label = source === 'system' ? '系统音频' : '麦克风';
        if (source === 'microphone') {
          let permission = 'unknown';
          try {
            permission = this.dependencies.microphonePermission();
          } catch {}
          if (permission !== 'granted')
            return {
              source,
              status: permission === 'denied' || permission === 'restricted' ? 'denied' : 'error',
              message:
                permission === 'denied' || permission === 'restricted'
                  ? '麦克风权限未开启，请在 Windows 设置中允许桌面应用访问麦克风。'
                  : '无法确认麦克风权限，请检查 Windows 麦克风隐私设置后重试。',
            };
        }
        const selected = options[source];
        if (
          !devices.some(
            (device) =>
              device.source === source && (selected ? device.id === selected : device.default),
          )
        )
          return {
            source,
            status: 'unavailable',
            message: `${selected ? '所选' : '默认'}${label}设备不可用，请在面试设置中重新选择。`,
          };
        try {
          const result = await this.dependencies.probe(source, selected);
          if (result.ok) return { source, status: 'granted', message: `${label}可用` };
          if (result.code?.toUpperCase() === '0X80070005')
            return {
              source,
              status: 'denied',
              message: `${label}访问被拒绝，请检查 Windows 隐私设置和设备权限。`,
            };
          return {
            source,
            status: 'error',
            message: `${label}无法初始化，请检查设备是否被独占或已断开后重新检查。`,
          };
        } catch {
          return { source, status: 'error', message: `${label}检查失败，请重新检查。` };
        }
      }),
    );
    return { ready: checks.every((check) => check.status === 'granted'), devices, checks };
  }
}

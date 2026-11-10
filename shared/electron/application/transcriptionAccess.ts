import type { AudioDevice, InterviewAccessReport, SpeechOptions } from '../contracts/speech';
import { validateSpeech } from '../backend/speech/validation';

interface Dependencies {
  platform: string;
  microphonePermission(): string;
  devices(): Promise<AudioDevice[]>;
  probe(source: 'microphone', device?: string): Promise<{ ok: boolean; code?: string }>;
}

/** Preflight the selected microphone only; native adapters own permission prompts. */
export async function checkTranscriptionAccess(
  options: SpeechOptions,
  dependencies: Dependencies,
): Promise<InterviewAccessReport> {
  const call = validateSpeech({ op: 'start', options });
  if (
    call.op !== 'start' ||
    call.options.sources.length !== 1 ||
    call.options.sources[0] !== 'microphone'
  )
    throw Error('Invalid audio sources');
  let devices: AudioDevice[] = [];
  const result = (status: InterviewAccessReport['checks'][number]['status'], message: string) => ({
    ready: status === 'granted',
    devices,
    checks: [{ source: 'microphone' as const, status, message }],
  });
  if (!['win32', 'darwin'].includes(dependencies.platform))
    return result('error', '当前系统尚未支持本地音频采集。');
  try {
    devices = (await dependencies.devices()).filter((device) => device.source === 'microphone');
  } catch {
    return result('error', '无法检查音频设备，请检查设备连接后重新检查。');
  }
  let permission = 'unknown';
  try {
    permission = dependencies.microphonePermission();
  } catch {}
  const denied =
    dependencies.platform === 'win32'
      ? '麦克风权限未开启，请在 Windows 设置中允许桌面应用访问麦克风。'
      : '麦克风权限未开启，请在 macOS 隐私与安全性设置中允许 VoxCue 访问麦克风后重试。';
  if (permission === 'denied' || permission === 'restricted') return result('denied', denied);
  if (dependencies.platform === 'win32' && permission !== 'granted')
    return result('error', '无法确认麦克风权限，请检查 Windows 麦克风隐私设置后重试。');
  const selected = call.options.microphone;
  if (!devices.some((device) => (selected ? device.id === selected : device.default)))
    return result(
      'unavailable',
      `${selected ? '所选' : '默认'}麦克风设备不可用，请在面试设置中重新选择。`,
    );
  try {
    const probe = await dependencies.probe('microphone', selected);
    if (probe.ok) return result('granted', '麦克风可用');
    if (probe.code === 'permission-denied' || probe.code?.toUpperCase() === '0X80070005')
      return result('denied', denied);
    return result('error', '麦克风无法初始化，请检查设备是否被独占或已断开后重新检查。');
  } catch {
    return result('error', '麦克风检查失败，请重新检查。');
  }
}

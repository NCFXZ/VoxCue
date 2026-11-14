import { expect, it } from 'vitest';
import { interviewReadiness } from '../../../shared/src/services/interviewReadiness';
import { recordAudioLevel } from '../../../shared/src/services/audioLevel';
import type { SpeechStatus } from '../../../shared/electron/contracts/speech';

const now = 10000;
it('reports a runtime-muted system lane as off without hiding the healthy microphone or model', () => {
  const value = { ...state(), systemAudioMuted: true };
  expect(interviewReadiness('system', value, now)).toMatchObject({ kind: 'off', level: 0 });
  expect(interviewReadiness('model', value, now).kind).toBe('normal');
  expect(interviewReadiness('microphone', value, now).kind).not.toBe('off');
  expect(interviewReadiness('system', { ...value, systemAudioMuted: false }, now).kind).toBe(
    'input',
  );
});
it('shows a muted transcription microphone as off even with stale RMS, while remote follows its saved source selection', () => {
  const value = { ...state(), inputMode: 'transcription' as const, microphoneMuted: true };
  expect(interviewReadiness('microphone', value, now)).toEqual({
    kind: 'off',
    reason: '麦克风已关闭，不采集声音。',
    level: 0,
  });
  expect(interviewReadiness('microphone', { ...value, inputMode: 'remote' }, now).kind).not.toBe(
    'off',
  );
  expect(
    interviewReadiness(
      'microphone',
      { ...value, inputMode: 'remote', options: { sources: ['system'] } },
      now,
    ).kind,
  ).toBe('off');
});
function state() {
  return {
    speech: { state: 'running', model: 'synthetic' } as SpeechStatus,
    speechError: null as string | null,
    speechWarnings: {} as Partial<Record<'microphone' | 'system', string>>,
    options: { sources: ['microphone', 'system'] as ('microphone' | 'system')[] },
    audioLevels: {
      system: recordAudioLevel(undefined, 0.08, false, now),
      microphone: recordAudioLevel(undefined, 0.002, false, now),
    },
    reconnecting: false,
  };
}
it('只有音源显示输入；系统非语音声音有效，静音/底噪正常，模型始终显示勾', () => {
  const value = state();
  expect(interviewReadiness('model', value, now).kind).toBe('normal');
  expect(interviewReadiness('system', value, now).kind).toBe('input');
  expect(interviewReadiness('microphone', value, now).kind).toBe('normal');
  value.audioLevels.microphone = recordAudioLevel(undefined, 0.002, true, now);
  expect(interviewReadiness('microphone', value, now).kind).toBe('input');
  value.options.sources = ['system'];
  expect(interviewReadiness('microphone', value, now).kind).toBe('off');
});
it('输入短暂静默保留并衰减电平，800ms后恢复正常，非法与未来时间不显示输入', () => {
  const value = state();
  value.audioLevels.system = recordAudioLevel(value.audioLevels.system, 0, false, now + 100);
  const start = interviewReadiness('system', value, now);
  const tail = interviewReadiness('system', value, now + 600);
  expect(tail.kind).toBe('input');
  expect(tail.level).toBeLessThan(start.level);
  expect(interviewReadiness('system', value, now + 800).kind).toBe('normal');
  expect(interviewReadiness('system', value, now - 1).kind).toBe('normal');
  for (const invalid of [NaN, Infinity, -1, 0])
    expect(recordAudioLevel(undefined, invalid, true, now).inputAt).toBeUndefined();
});
it('异常只落到受影响组件，其他组件显示暂停及具体原因；警告优先于输入', () => {
  const value = state();
  value.speechWarnings.system = '系统音频短暂间断';
  expect(interviewReadiness('system', value, now)).toMatchObject({
    kind: 'error',
    reason: '系统音频短暂间断',
  });
  value.speechWarnings = {};
  value.speech = {
    state: 'error',
    model: 'synthetic',
    error: '麦克风连接断开',
    failureSource: 'microphone',
  };
  expect(interviewReadiness('microphone', value, now)).toMatchObject({
    kind: 'error',
    reason: '麦克风连接断开',
  });
  expect(interviewReadiness('system', value, now)).toMatchObject({
    kind: 'paused',
    reason: '音频链路已停止，等待恢复：{0}',
    detail: '麦克风连接断开',
  });
  expect(interviewReadiness('model', value, now).kind).toBe('paused');
  value.speech.failureSource = 'model';
  value.speech.error = '识别进程退出';
  expect(interviewReadiness('model', value, now).kind).toBe('error');
  expect(interviewReadiness('microphone', value, now).kind).toBe('paused');
  value.reconnecting = true;
  expect(interviewReadiness('model', value, now).kind).toBe('loading');
  value.options.sources = ['system'];
  expect(interviewReadiness('microphone', value, now).kind).toBe('off');
});

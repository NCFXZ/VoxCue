import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useGeneralSettings } from '../../src/stores/generalSettings';
const current = vi.hoisted(() => ({
  inputMode: 'remote' as 'remote' | 'transcription',
  muted: false,
  changing: false,
}));
vi.mock('../../src/stores/interview', () => {
  const state = () => ({
    inputMode: current.inputMode,
    inputChanging: current.changing,
    microphoneMuted: current.muted,
    microphoneToggling: false,
    options: {
      sources: ['microphone', 'system'],
      microphone: 'saved-mic',
      system: 'saved-output',
      speechModel: 'paraformer',
      inferenceDevice: 'cpu',
    },
    modelId: '',
    effort: 'auto',
    reconnecting: false,
    updatingModel: false,
    switchingSpeech: false,
    speech: { state: 'running', model: 'Synthetic' },
    status: 'running',
    speechSwitchError: null,
    setInputMode: vi.fn(async () => true),
    toggleMicrophone: vi.fn(async () => true),
  });
  return { useInterview: Object.assign(() => state(), { getState: state }) };
});
vi.mock('../../src/components/useAudioDevices', () => ({
  useAudioDevices: () => ({
    devices: [
      { id: 'saved-mic', source: 'microphone', name: 'Saved microphone' },
      { id: 'saved-output', source: 'system', name: 'Saved output' },
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('../../src/stores/components', () => ({ useComponentReady: () => true }));
import { InterviewSettingsPanel } from '../../src/components/InterviewSettingsPanel';
beforeEach(() => {
  current.inputMode = 'remote';
  current.muted = false;
  current.changing = false;
  useGeneralSettings.setState({ language: 'zh-CN' });
  vi.stubGlobal('window', { desktop: { platform: 'windows' } });
});
afterEach(() => vi.unstubAllGlobals());
const render = () => renderToStaticMarkup(<InterviewSettingsPanel onClose={() => {}} />);
it('keeps the same mode control at runtime and displays soft-muted remote microphone state', () => {
  current.muted = true;
  const html = render();
  expect(html).toContain('class="interview-input-mode speech-setting-row"');
  expect(html).toContain('role="radiogroup"');
  expect(html).toMatch(/aria-label="选择麦克风"[^>]*><span[^>]*>不使用麦克风<\/span>/);
  expect(html).toContain('<span class="speech-setting-label">系统声音</span>');
  expect(html).not.toContain('系统声音 · 播放设备');
});
it('keeps the disabled system reason inside the runtime dropdown and disables mode changes until input ACK', () => {
  current.inputMode = 'transcription';
  current.changing = true;
  const html = render();
  expect(html).toMatch(
    /aria-label="选择播放设备"[^>]*><span[^>]*>设置为“仅转录”时不可用。<\/span>/,
  );
  expect(html).not.toContain('<small class="interview-input-unavailable">设置为“仅转录”时不可用。');
  const choices = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)];
  expect(choices).toHaveLength(2);
  expect(choices.every((match) => match[0].includes('disabled=""'))).toBe(true);
  expect(html).not.toContain('不使用麦克风');
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useGeneralSettings } from '../../src/stores/generalSettings';
const current = vi.hoisted(() => ({
  inputMode: 'remote' as 'remote' | 'transcription',
  muted: false,
  changing: false,
  requesting: false,
  loadingQwen: false,
  switching: undefined as 'loading' | 'waiting' | undefined,
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
      speechModel: current.loadingQwen ? 'qwen' : 'paraformer',
      inferenceDevice: 'cpu',
    },
    modelId: '',
    effort: 'auto',
    reconnecting: false,
    updatingModel: false,
    switchingSpeech: current.requesting || !!current.switching,
    speech: { state: current.loadingQwen ? 'loading' : 'running', model: 'Synthetic',
      switching: current.switching, switchId: current.switching ? 7 : undefined },
    status: 'running',
    speechSwitchError: null,
    setInputMode: vi.fn(async () => true),
    toggleMicrophone: vi.fn(async () => true),
  });
  return { useInterview: Object.assign((select: (s: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }), useInterviewPanelState: state };
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
import { InterviewAudioRecovery } from '../../src/components/InterviewAudioRecovery';
beforeEach(() => {
  current.inputMode = 'remote';
  current.muted = false;
  current.changing = false;
  current.requesting = false;
  current.loadingQwen = false;
  current.switching = undefined;
  useGeneralSettings.setState({ language: 'zh-CN' });
  vi.stubGlobal('window', { desktop: { platform: 'windows' } });
});
afterEach(() => vi.unstubAllGlobals());
const render = () => renderToStaticMarkup(<InterviewSettingsPanel onClose={() => {}} />);
it('renders both actions with the loading message before the worker acknowledges the request', () => {
  current.requesting = true;
  for (const html of [render(), renderToStaticMarkup(<InterviewAudioRecovery onSettings={() => {}} />)]) {
    expect(html).toContain('原配置继续转写');
    expect(html).toContain('ui-loader');
    expect(html).toContain('取消切换');
  }
});
it.each(['loading', 'waiting'] as const)('设置与面试提示都显示当前阶段可用的切换操作 (%s)', phase => {
  current.switching = phase;
  const notice = renderToStaticMarkup(<InterviewAudioRecovery onSettings={() => {}} />);
  expect(notice).toContain('aria-label="关闭提示"');
  for (const html of [render(), notice]) {
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const now = buttons.find(button => button.includes(phase === 'loading' ? '加载中' : '立即切换'));
    const cancel = buttons.find(button => button.includes('取消切换'));
    expect(now).toContain('<svg');
    expect(cancel).toContain('<svg');
    expect(now?.includes('disabled=""')).toBe(phase === 'loading');
    expect(now?.includes('ui-loader')).toBe(phase === 'loading');
    expect(cancel).not.toContain('disabled=""');
  }
});
it('allows the model picker during the initial Qwen load while capture devices stay locked', () => {
  current.loadingQwen = true;
  const buttons = render().match(/<button\b[^>]*>/g) ?? [];
  const model = buttons.find(button => button.includes('aria-label="语音识别模型"'));
  expect(model).toBeDefined();
  expect(model).not.toContain('disabled=');
  expect(buttons.find(button => button.includes('aria-label="选择麦克风"'))).toContain('disabled=');
});
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
    /aria-label="选择播放设备"[^>]*><span[^>]*>设置为“现场面试”时不可用。<\/span>/,
  );
  expect(html).not.toContain('<small class="interview-input-unavailable">设置为“现场面试”时不可用。');
  const choices = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)];
  expect(choices).toHaveLength(2);
  expect(choices.every((match) => match[0].includes('disabled=""'))).toBe(true);
  expect(html).not.toContain('不使用麦克风');
});

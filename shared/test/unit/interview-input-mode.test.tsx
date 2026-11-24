import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultInterviewConfiguration } from '../../src/services/speech';
import { resolveInterviewInput } from '../../src/services/interviewInput';
import { InterviewInputModeControl } from '../../src/components/InterviewInputModeControl';
import { SpeechControls } from '../../src/components/SpeechControls';
import { useGeneralSettings } from '../../src/stores/generalSettings';
const availability = vi.hoisted(() => ({ microphone: true }));
vi.mock('../../src/components/useAudioDevices', () => ({
  useAudioDevices: () => ({
    devices: [
      ...(availability.microphone
        ? [{ id: 'saved-mic', source: 'microphone', name: 'Saved microphone' }]
        : []),
      { id: 'saved-output', source: 'system', name: 'Saved output' },
    ],
    loading: false,
    loaded: true,
    error: null,
  }),
}));
vi.mock('../../src/stores/components', () => ({ useComponentReady: () => true }));
beforeEach(() => {
  availability.microphone = true;
  useGeneralSettings.setState({ language: 'zh-CN' });
  vi.stubGlobal('window', {
    desktop: { platform: 'windows', screenCapturePermissionSupported: false },
  });
});
afterEach(() => vi.unstubAllGlobals());
it('does not recommend the unavailable microphone-off option when transcription has no microphone', () => {
  availability.microphone = false;
  const html = renderToStaticMarkup(
    <SpeechControls
      inputMode="transcription"
      value={defaultInterviewConfiguration()}
      onChange={() => {}}
      busy={false}
      models={[]}
      live={false}
    />,
  );
  expect(html).toContain('请连接麦克风，或重新选择麦克风设备。');
  expect(html).not.toContain('请连接麦克风，或选择“不使用麦克风”。');
});
it('applies microphone-only capture to a copy while retaining the original remote device and enable preferences', () => {
  const configuration = defaultInterviewConfiguration();
  configuration.options = {
    ...configuration.options,
    sources: ['system'],
    microphone: 'saved-mic',
    system: 'saved-output',
  };
  const saved = structuredClone(configuration);
  const transcription = resolveInterviewInput(configuration, 'transcription');
  expect(transcription).toMatchObject({
    inputMode: 'transcription',
    options: { sources: ['microphone'], microphone: 'saved-mic', system: 'saved-output' },
  });
  transcription.options.microphone = 'changed-copy';
  expect(configuration).toEqual(saved);
  expect(resolveInterviewInput(configuration, 'remote')).toMatchObject({
    inputMode: 'remote',
    options: saved.options,
  });
});
it('renders one selected, focusable radio and keeps both choices disabled while busy', () => {
  const html = renderToStaticMarkup(
    <InterviewInputModeControl value="transcription" onChange={() => {}} />,
  );
  expect(html).toContain('role="radiogroup"');
  expect([...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((match) => match[0])).toEqual([
    expect.stringMatching(/aria-checked="false"[^>]*tabindex="-1"/),
    expect.stringMatching(/aria-checked="true"[^>]*tabindex="0"/),
  ]);
  const busy = renderToStaticMarkup(
    <InterviewInputModeControl value="remote" onChange={() => {}} disabled />,
  );
  expect(
    [...busy.matchAll(/<button[^>]*role="radio"[^>]*>/g)].every((match) =>
      match[0].includes('disabled=""'),
    ),
  ).toBe(true);
});
it('keeps device headings primary, removes their icons, and shows the disabled reason inside the playback control', () => {
  const configuration = defaultInterviewConfiguration();
  configuration.options = {
    ...configuration.options,
    sources: ['system'],
    microphone: 'saved-mic',
    system: 'saved-output',
  };
  const render = (inputMode: 'remote' | 'transcription') =>
    renderToStaticMarkup(
      <SpeechControls
        inputMode={inputMode}
        value={configuration}
        onChange={() => {}}
        busy={false}
        models={[]}
        live={false}
      />,
    );
  const remote = render('remote'),
    transcription = render('transcription');
  expect(remote.match(/<button[^>]*aria-label="播放设备"[^>]*>/)?.[0]).not.toContain('disabled=""');
  expect(transcription.match(/<button[^>]*aria-label="播放设备"[^>]*>/)?.[0]).toContain(
    'disabled=""',
  );
  expect(transcription).toMatch(
    /class="speech-device speech-setting-row "[^>]*><div class="speech-device-heading speech-setting-label"><strong>系统音频<\/strong>/,
  );
  expect(transcription.match(/<button[^>]*aria-label="麦克风设备"[^>]*>/)?.[0]).not.toContain(
    'disabled=""',
  );
  expect(transcription).toMatch(
    /aria-label="播放设备"[^>]*><span[^>]*>设置为“现场面试”时不可用。<\/span>/,
  );
  expect(transcription).not.toContain('<small class="interview-input-unavailable">');
  expect(remote).not.toContain('设置为“现场面试”时不可用。');
  expect(transcription).toContain('Saved microphone');
  const headings = [
    ...transcription.matchAll(/class="speech-device-heading speech-setting-label">(.*?)<\/div>/g),
  ].map((match) => match[1]);
  expect(headings).toEqual([
    '<strong>系统音频</strong><span>面试官</span>',
    '<strong>麦克风</strong><span>面试者</span>',
  ]);
});

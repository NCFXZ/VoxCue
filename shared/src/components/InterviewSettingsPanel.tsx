import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { SpeechOptions } from '../../electron/contracts/speech';
import type { ChatModel, ReasoningEffort } from '../../electron/contracts/chat';
import { useInterview, useInterviewPanelState } from '../stores/interview';
import { InterviewDisplayControls } from './InterviewDisplayControls';
import { resolveReasoningEffort } from '../services/chatOptions';
import { ModelReasoningControl } from './ReasoningEffortControl';
import { ChoiceMenu } from './ui/choice-menu';
import { Modal } from './ui/modal';
import { useAudioDevices } from './useAudioDevices';
import { SpeechModelSettings } from './SpeechModelSettings';
import { SpeechSwitchActions, switchDescription } from './SpeechSwitchActions';
import { InterviewReveal } from './InterviewReveal';
import { InterviewInputModeControl } from './InterviewInputModeControl';
import { useHeightTransition } from './ui/useHeightTransition';
import type { InterviewInputMode } from '../../electron/contracts/speech';
import { RemoteConnectionSettings } from './RemoteConnection';
import { useSettingsTarget, type SettingsTarget } from './ui/useSettingsTarget';

export function InterviewSettingsPanel({ onClose, targets }: { onClose(): void; targets?: readonly SettingsTarget[] }) {
  const content = useRef<HTMLDivElement>(null);
  useSettingsTarget(content, targets);
  const state = useInterviewPanelState();
  const [options, setOptions] = useState<SpeechOptions>(() => structuredClone(state.options));
  const { devices, loading, error: devicesError } = useAudioDevices();
  const [models, setModels] = useState<ChatModel[]>([]);
  const [modelId, setModelId] = useState(state.modelId);
  const [effort, setEffort] = useState<ReasoningEffort | 'auto'>(state.effort);
  const [modelLoading, setModelLoading] = useState(true);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [modelError, setModelError] = useState('');
  const [error, setError] = useState('');
  const settingsError = t(error || modelError || state.speechSwitchError || devicesError);
  const busy = state.reconnecting || state.updatingModel || state.inputChanging;
  const audioBusy =
    busy || state.switchingSpeech || state.microphoneToggling || state.systemAudioToggling;
  const transcription = state.inputMode === 'transcription';
  const audioSection = useRef<HTMLElement>(null);
  useHeightTransition(state.inputMode, () => [audioSection.current]);
  const changeInputMode = async (mode: InterviewInputMode) => {
    setError('');
    if (!(await state.setInputMode(mode))) {
      const current = useInterview.getState();
      setError(current.error ?? current.speechError ?? '面试方式切换失败，请重试。');
    }
  };
  useEffect(() => {
    if (!state.switchingSpeech && !state.reconnecting) setOptions(structuredClone(state.options));
  }, [state.options, state.switchingSpeech, state.reconnecting]);
  useEffect(() => {
    let disposed = false;
    setModelLoading(true);
    setModelError('');
    void window
      .desktop!.interviewModels(catalogRefresh > 0)
      .then((result) => {
        if (disposed) return;
        if (!result.ok) throw Error(result.error.message);
        setModels(result.models);
        const current = useInterview.getState();
        if (current.aiEnabled && !result.models.some((model) => model.id === current.modelId))
          setModelError('所选模型当前不可用，请重新选择模型。');
      })
      .catch((cause) => {
        if (disposed) return;
        setModels([]);
        setModelError(cause instanceof Error ? cause.message : '无法读取回答模型，请稍后重试。');
      })
      .finally(() => {
        if (!disposed) setModelLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [catalogRefresh]);
  const changeAudio = async (next: SpeechOptions) => {
    if (
      useInterview.getState().microphoneToggling ||
      useInterview.getState().systemAudioToggling ||
      useInterview.getState().inputChanging
    )
      return;
    setError('');
    setOptions(next);
    if (!(await state.reconnectAudio(next))) {
      setOptions(structuredClone(useInterview.getState().options));
      const current = useInterview.getState();
      setError(current.speechSwitchError ?? current.speechError ?? '音频连接失败，请重试。');
    }
  };
  const changeModel = async (id: string, nextEffort: ReasoningEffort | 'auto') => {
    const current = useInterview.getState();
    if (current.updatingModel || current.reconnecting || current.status === 'ended') return;
    setError('');
    setModelId(id);
    setEffort(nextEffort);
    try {
      if (!(await state.updateModel(id, nextEffort, models))) throw Error('模型设置未能保存，请重试。');
      setModelError('');
    } catch (e) {
      const confirmed = useInterview.getState();
      setModelId(confirmed.modelId);
      setEffort(confirmed.effort);
      setError(e instanceof Error ? e.message : '模型设置失败。');
    }
  };
  return (
    <Modal
      title={t('面试设置')}
      fixedHeader
      overlayHeader
      backdrop="transparent"
      className="interview-settings-dialog"
      contentRef={content}
      onClose={onClose}
    >
      <InterviewInputModeControl
        value={state.inputMode}
        onChange={(mode) => void changeInputMode(mode)}
        disabled={audioBusy || state.speech.state === 'loading' || state.status === 'ended'}
      />
      <section ref={audioSection} className="interview-settings-section interview-audio-settings" data-settings-highlight-group>
        <h3>{t('音频设置')}</h3>
        <div className="audio-device-editor" data-settings-target="audio-devices">
          {(['system', 'microphone'] as const).map((source) => (
            <label className="speech-setting-row" key={source} data-settings-target={source}>
              <div className="interview-device-label">
                <span className="speech-setting-label">{source === 'system' ? t('系统声音') : t('麦克风')}</span>
                <InterviewReveal>{source === 'microphone' && transcription && state.microphoneMuted ? (
                  <small className="interview-input-unavailable">
                    {t('麦克风已关闭，不采集声音。')}
                  </small>
                ) : source === 'system' && !transcription && state.systemAudioMuted ? (
                  <small className="interview-input-unavailable">
                    {t('系统声音已关闭。开启麦克风时，播放声仅用于消除回声。')}
                  </small>
                ) : null}</InterviewReveal>
              </div>
              <ChoiceMenu
                label={source === 'system' ? t('选择播放设备') : t('选择麦克风')}
                className={
                  source === 'system' && transcription ? 'interview-system-unavailable' : ''
                }
                displayLabel={
                  source === 'system' && transcription ? t('设置为“现场面试”时不可用。') : undefined
                }
                disabled={
                  loading ||
                  audioBusy ||
                  state.speech.state === 'loading' ||
                  (source === 'system' && transcription)
                }
                value={
                  source === 'microphone' &&
                  !transcription &&
                  (state.microphoneMuted || !options.sources.includes(source))
                    ? '__off__'
                    : (options[source] ?? '')
                }
                options={[
                  ...(source === 'microphone' && !transcription
                    ? [{ value: '__off__', label: t('不使用麦克风') }]
                    : []),
                  { value: '', label: source === 'system' ? t('默认播放设备') : t('默认麦克风') },
                  ...(options[source] &&
                  !devices.some((d) => d.source === source && d.id === options[source])
                    ? [{ value: options[source]!, label: t('所选设备已不可用') }]
                    : []),
                  ...devices
                    .filter((d) => d.source === source)
                    .map((d) => ({ value: d.id, label: d.name })),
                ]}
                onChange={(id) => {
                  if (source === 'microphone' && !transcription) {
                    const off = id === '__off__';
                    const sameDevice = off || (id || undefined) === options.microphone;
                    if (sameDevice) {
                      if (off !== state.microphoneMuted) void state.toggleMicrophone();
                      return;
                    }
                  }
                  void changeAudio({
                    ...options,
                    [source]: id === '__off__' ? options[source] : id || undefined,
                    sources: transcription
                      ? ['microphone']
                      : source === 'microphone'
                        ? id === '__off__'
                          ? ['system']
                          : ['microphone', 'system']
                        : options.sources,
                  });
                }}
              />
            </label>
          ))}
        </div>
      </section>
      <RemoteConnectionSettings />
      <section className="interview-settings-section interview-model-settings">
        <h3>{t('模型设置')}</h3>
        <SpeechModelSettings
          options={options}
          disabled={audioBusy || state.speech.state === 'loading'}
          allowParaformer={!audioBusy && state.speech.state === 'loading' && state.options.speechModel === 'qwen'}
          onChange={(next) => void changeAudio(next)}
          switchStatus={
            <InterviewReveal>{state.switchingSpeech ? (
              <div className="interview-switch-row">
                <p className="speech-model-status" role="status">
                  {switchDescription(state.speech.switching ?? 'loading')}
                </p>
                <div className="interview-switch-actions">
                  <SpeechSwitchActions phase={state.speech.switching ?? 'loading'} id={state.speech.switchId} />
                </div>
              </div>
            ) : null}</InterviewReveal>
          }
        >
          <div className="speech-setting-row">
            <span className="speech-setting-label">{t('回答模型')}</span>
            <ModelReasoningControl
              label={t('面试回答模型')}
              effortLabel={t('面试思考强度')}
              className="choice-trigger effort-model-trigger"
              modelId={modelId}
              models={models}
              effort={effort}
              disabled={!state.aiEnabled || state.reconnecting}
              busy={state.updatingModel}
              loading={modelLoading}
              error={modelError}
              onRefresh={() => setCatalogRefresh(value => value + 1)}
              onModelChange={(id) =>
                void changeModel(
                  id,
                  resolveReasoningEffort(
                    models.find((model) => model.id === id),
                    effort,
                  ),
                )
              }
              onEffortChange={(value) => void changeModel(modelId, value)}
            />
          </div>
        </SpeechModelSettings>
      </section>
      <section className="interview-settings-section interview-display-settings">
        <h3>{t('显示设置')}</h3>
        <InterviewDisplayControls />
      </section>
      <InterviewReveal resizeKey={settingsError}>{settingsError ? (
        <p className="danger-text" role="alert">
          {settingsError}
        </p>
      ) : null}</InterviewReveal>
    </Modal>
  );
}

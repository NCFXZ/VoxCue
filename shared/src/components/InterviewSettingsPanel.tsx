import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { SpeechOptions } from '../../electron/contracts/speech';
import type { ChatModel, ReasoningEffort } from '../../electron/contracts/chat';
import { useInterview } from '../stores/interview';
import { InterviewDisplayControls } from './InterviewDisplayControls';
import { resolveReasoningEffort } from '../services/chatOptions';
import { ModelReasoningControl } from './ReasoningEffortControl';
import { ChoiceMenu } from './ui/choice-menu';
import { Modal } from './ui/modal';
import { useAudioDevices } from './useAudioDevices';
import { SpeechModelSettings } from './SpeechModelSettings';

export function InterviewSettingsPanel({ onClose }: { onClose(): void }) {
  const state = useInterview();
  const [options, setOptions] = useState<SpeechOptions>(() => structuredClone(state.options));
  const { devices, loading, error: devicesError } = useAudioDevices();
  const [models, setModels] = useState<ChatModel[]>([]);
  const [modelId, setModelId] = useState(state.modelId);
  const [effort, setEffort] = useState<ReasoningEffort | 'auto'>(state.effort);
  const [modelLoading, setModelLoading] = useState(true);
  const [error, setError] = useState('');
  const busy = state.reconnecting || state.updatingModel;
  const audioBusy = busy || state.switchingSpeech;
  useEffect(() => {
    if (!state.switchingSpeech && !state.reconnecting) setOptions(structuredClone(state.options));
  }, [state.options, state.switchingSpeech, state.reconnecting]);
  useEffect(() => {
    let disposed = false;
    void window
      .desktop!.interviewModels()
      .then((result) => {
        if (disposed) return;
        if (!result.ok) throw Error(result.error.message);
        setModels(result.models);
      })
      .catch(() => {
        if (!disposed) setError('无法读取回答模型，请稍后重试。');
      })
      .finally(() => {
        if (!disposed) setModelLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const changeAudio = async (next: SpeechOptions) => {
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
      if (!(await state.updateModel(id, nextEffort))) throw Error('模型设置未能保存，请重试。');
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
      onClose={onClose}
    >
      <section className="interview-settings-section">
        <h3>{t('音频设置')}</h3>
        <div className="audio-device-editor">
          {(['system', 'microphone'] as const).map((source) => (
            <label className="speech-setting-row" key={source}>
              <span className="speech-setting-label">
                {source === 'system' ? t('系统声音 · 播放设备') : t('麦克风')}
              </span>
              <ChoiceMenu
                label={source === 'system' ? t('选择播放设备') : t('选择麦克风')}
                disabled={loading || audioBusy || state.speech.state === 'loading'}
                value={
                  source === 'microphone' && !options.sources.includes(source)
                    ? '__off__'
                    : (options[source] ?? '')
                }
                options={[
                  ...(source === 'microphone'
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
                onChange={(id) =>
                  void changeAudio({
                    ...options,
                    [source]: id === '__off__' ? options[source] : id || undefined,
                    sources:
                      source === 'microphone'
                        ? id === '__off__'
                          ? ['system']
                          : ['microphone', 'system']
                        : options.sources,
                  })
                }
              />
            </label>
          ))}
        </div>
      </section>
      <section className="interview-settings-section">
        <h3>{t('模型设置')}</h3>
        <SpeechModelSettings
          options={options}
          disabled={audioBusy || state.speech.state === 'loading'}
          switching={state.switchingSpeech ? (state.speech.switching ?? 'loading') : undefined}
          onChange={(next) => void changeAudio(next)}
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
              disabled={modelLoading || state.reconnecting}
              busy={state.updatingModel}
              loading={modelLoading}
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
      {(error || state.speechSwitchError || devicesError) && (
        <p className="danger-text" role="alert">
          {t(error || state.speechSwitchError || devicesError)}
        </p>
      )}
    </Modal>
  );
}

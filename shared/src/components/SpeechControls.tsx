import { t } from '../i18n';
import * as Menu from './ui/dropdown-menu';
import { Button } from './ui/button';
import { Check } from './icons';
import type { AudioSource, InterviewConfiguration } from '../../electron/contracts/speech';
import type { ChatModel } from '../../electron/contracts/chat';
import { resolveReasoningEffort } from '../services/chatOptions';
import { ModelReasoningControl } from './ReasoningEffortControl';
import { ScreenCaptureSettings } from './ScreenCaptureSettings';
import { useAudioDevices } from './useAudioDevices';
import { useAuth } from '../stores/auth';
import { SpeechModelSettings } from './SpeechModelSettings';
import { InterviewReveal } from './InterviewReveal';
import { RemoteConnectionSettings } from './RemoteConnection';
import type { InterviewInputMode } from '../services/interviewInput';

export function SpeechControls({
  value,
  onChange,
  busy,
  models,
  live,
  modelLoading,
  modelError,
  refreshModels,
  inputMode = 'remote',
}: {
  value: InterviewConfiguration;
  onChange(value: InterviewConfiguration): void;
  busy: boolean;
  models: ChatModel[];
  live: boolean;
  modelLoading?: boolean;
  modelError?: string | null;
  refreshModels?(): void;
  inputMode?: InterviewInputMode;
}) {
  const { devices, loading: devicesLoading, loaded: devicesLoaded, error } = useAudioDevices();
  const resolved = useAuth((state) => state.resolved);
  const authError = useAuth((state) => state.error);
  const microphoneAvailable = devices.some(
    (d) =>
      d.source === 'microphone' && (!value.options.microphone || d.id === value.options.microphone),
  );
  const model = models.find((m) => m.id === value.modelId);
  const change = (patch: Partial<InterviewConfiguration>) => {
    const next = { ...value, ...patch };
    onChange(next);
  };
  const selectModel = (modelId: string) => {
    const nextModel = models.find((m) => m.id === modelId);
    change({
      modelId,
      effort: resolveReasoningEffort(nextModel, value.effort),
    });
  };
  const choose = (
    label: string,
    selected: string,
    choices: Array<{ id: string; label: string; disabled?: boolean }>,
    update: (v: string) => void,
    disabled = false,
    placeholder = label,
    displayLabel?: string,
    unavailable = false,
  ) => {
    const selectedLabel =
      displayLabel ?? choices.find((c) => c.id === selected)?.label ?? placeholder;
    return (
      <Menu.Root>
        <Menu.Trigger asChild disabled={busy || disabled}>
          <Button
            type="button"
            variant="outline"
            className={`speech-select${unavailable ? ' interview-system-unavailable' : ''}`}
            disabled={busy || disabled}
            aria-label={t(label)}
          >
            <span title={selectedLabel}>{selectedLabel}</span>
            <Menu.TriggerChevron />
          </Button>
        </Menu.Trigger>
        {/* Native <dialog> is in the top layer; keep menus inside it. */}
        <Menu.Content
          className="dropdown-content compact-tool-menu speech-select-menu"
          sideOffset={6}
          align="end"
        >
          <Menu.RadioGroup value={selected} onValueChange={update}>
            {choices.map((c) => (
              <Menu.RadioItem
                className="dropdown-item model-option"
                value={c.id}
                key={c.id}
                disabled={c.disabled}
              >
                <span>{c.label}</span>
                <Menu.ItemIndicator className="dropdown-check">
                  <Check size={13} />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Root>
    );
  };
  return (
    <div className="speech-controls">
      {
        <section className="speech-settings-section" aria-label={t('音频设备')}>
          <div className="speech-section-heading">
            <h3>{t('音频设备')}</h3>
          </div>
          <div className="speech-device-grid">
            {(['system', 'microphone'] as AudioSource[]).map((source) => {
              const microphone = source === 'microphone';
              const transcription = inputMode === 'transcription';
              const enabled = transcription ? microphone : value.options.sources.includes(source);
              return (
                <div
                  className={`speech-device speech-setting-row ${enabled || (!microphone && transcription) ? '' : 'is-disabled'}`}
                  key={source}
                >
                  <div className="speech-device-heading speech-setting-label">
                    <strong>{microphone ? t('麦克风') : t('系统音频')}</strong>
                    <span>{microphone ? t('面试者') : t('面试官')}</span>
                  </div>
                  {choose(
                    microphone ? t('麦克风设备') : t('播放设备'),
                    microphone && !enabled ? '__disabled__' : (value.options[source] ?? ''),
                    [
                      ...(microphone && !transcription
                        ? [{ id: '__disabled__', label: t('不使用麦克风') }]
                        : []),
                      {
                        id: '',
                        label: microphone ? t('默认麦克风') : t('默认播放设备'),
                        disabled:
                          microphone &&
                          devicesLoaded &&
                          !devices.some((d) => d.source === 'microphone'),
                      },
                      ...devices
                        .filter((d) => d.source === source)
                        .map((d) => ({ id: d.id, label: d.name })),
                    ],
                    (device) => {
                      change({
                        options: {
                          ...value.options,
                          [source]:
                            device === '__disabled__' ? value.options[source] : device || undefined,
                          sources:
                            microphone && !transcription
                              ? device === '__disabled__'
                                ? ['system']
                                : ['microphone', 'system']
                              : value.options.sources,
                        },
                      });
                    },
                    devicesLoading || (!microphone && transcription),
                    microphone ? t('默认麦克风') : t('默认播放设备'),
                    !microphone && transcription
                      ? t('设置为“现场面试”时不可用。')
                      : devicesLoading
                        ? t('正在读取设备…')
                        : microphone && enabled
                          ? error
                            ? t('设备读取失败')
                            : devicesLoaded && !microphoneAvailable
                              ? value.options.microphone
                                ? t('所选麦克风已不可用')
                                : t('未检测到麦克风')
                              : undefined
                          : undefined,
                    !microphone && transcription,
                  )}
                  <InterviewReveal className="speech-device-feedback">{microphone && enabled && (error || (devicesLoaded && !microphoneAvailable)) && (
                    <small className="speech-device-error" role="alert">
                      {t(
                        error ||
                          (transcription
                            ? '请连接麦克风，或重新选择麦克风设备。'
                            : '请连接麦克风，或选择“不使用麦克风”。'),
                      )}
                    </small>
                  )}</InterviewReveal>
                </div>
              );
            })}
          </div>
          <div className="settings-entry recording-preference">
            <div>
              <strong id="auto-record-label">{t('面试时自动录音')}</strong>
              <p id="auto-record-description">{t('录音仅保存在本机，不会上传至云端。')}</p>
            </div>
            <button type="button" className="settings-switch" role="switch"
              aria-labelledby="auto-record-label" aria-describedby="auto-record-description"
              aria-checked={!!value.autoRecord} disabled={busy}
              onClick={() => change({ autoRecord: !value.autoRecord })}><span /></button>
          </div>
        </section>
      }
      <ScreenCaptureSettings disabled={busy} />
      <RemoteConnectionSettings disabled={busy} />
      <section
        className="speech-settings-section speech-answer-settings"
        aria-label={t('模型设置')}
      >
        <div className="speech-section-heading">
          <h3>{t('模型设置')}</h3>
        </div>
        <SpeechModelSettings
          options={value.options}
          disabled={busy}
          onChange={(options) => change({ options })}
        >
          <div className="speech-setting-row">
            <span className="speech-setting-label">{t('回答模型')}</span>
            {live || !resolved ? (
              <ModelReasoningControl
                label={t('面试回答模型')}
                effortLabel={t('面试回答思考强度')}
                className="speech-select effort-model-trigger"
                models={models}
                onRequestModels={resolved ? undefined : useAuth.getState().ensure}
                loading={modelLoading}
                error={modelError || authError}
                onRefresh={live ? refreshModels : resolved ? undefined : useAuth.getState().ensure}
                modelId={value.modelId}
                onModelChange={selectModel}
                effort={value.effort}
                onEffortChange={(effort) => change({ effort })}
                disabled={busy}
              />
            ) : (
              <span className="speech-current-answer">{t('请先连接模型服务')}</span>
            )}
          </div>
          <InterviewReveal className="speech-answer-model-error">{live && models.length > 0 && value.modelId && !model && (
            <small role="alert" className="danger-text">{t('所选模型当前不可用，请重新选择模型。')}</small>
          )}</InterviewReveal>
        </SpeechModelSettings>
        <InterviewReveal className="speech-controls-error">{error && (
          <small role="alert" className="danger-text">{t(error)}</small>
        )}</InterviewReveal>
      </section>
    </div>
  );
}

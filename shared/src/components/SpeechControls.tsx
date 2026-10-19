import { useEffect } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Button } from './ui/button';
import { Check, ChevronDown, AudioLines, Volume2 } from './icons';
import type { AudioSource, InterviewConfiguration } from '../../electron/contracts/speech';
import type { ChatModel, ReasoningEffort } from '../../electron/contracts/chat';
import { effortLabels } from '../services/chatOptions';
import { ScreenCaptureSettings } from './ScreenCaptureSettings';
import { useAudioDevices } from './useAudioDevices';

export function SpeechControls({
  value,
  onChange,
  busy,
  models,
  live,
}: {
  value: InterviewConfiguration;
  onChange(value: InterviewConfiguration): void;
  busy: boolean;
  models: ChatModel[];
  live: boolean;
}) {
  const { devices, loading: devicesLoading, loaded: devicesLoaded, error } = useAudioDevices();
  const microphoneAvailable = devices.some(
    (d) =>
      d.source === 'microphone' && (!value.options.microphone || d.id === value.options.microphone),
  );
  const model = models.find((m) => m.id === value.modelId);
  const efforts = model?.reasoningEfforts ?? [];
  useEffect(() => {
    if (
      value.aiEnabled &&
      model &&
      value.effort !== 'auto' &&
      !model?.reasoningEfforts?.includes(value.effort)
    )
      onChange({ ...value, effort: model?.reasoningEfforts?.includes('low') ? 'low' : 'auto' });
  }, [value, model, onChange]);
  const change = (patch: Partial<InterviewConfiguration>) => {
    const next = { ...value, ...patch };
    onChange(next);
  };
  const selectModel = (modelId: string) => {
    const available = models.find((m) => m.id === modelId)?.reasoningEfforts ?? [];
    change({
      modelId,
      effort:
        value.effort === 'auto' || available.includes(value.effort as ReasoningEffort)
          ? value.effort
          : available.includes('low')
            ? 'low'
            : 'auto',
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
  ) => {
    const selectedLabel =
      displayLabel ?? choices.find((c) => c.id === selected)?.label ?? placeholder;
    return (
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            className="speech-select"
            disabled={busy || disabled}
            aria-label={label}
          >
            <span title={selectedLabel}>{selectedLabel}</span>
            <ChevronDown size={12} />
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
                <Menu.ItemIndicator>
                  <Check size={13} />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Root>
    );
  };
  useEffect(() => {
    if (!live || !models.length) return;
    const selected = models.find((m) => m.id === value.modelId) ?? models[0];
    if (!value.aiEnabled || selected.id !== value.modelId)
      onChange({
        ...value,
        mode: 'local',
        aiEnabled: true,
        modelId: selected.id,
        effort:
          selected.id === value.modelId &&
          (value.effort === 'auto' || selected.reasoningEfforts?.includes(value.effort))
            ? value.effort
            : selected.reasoningEfforts?.includes('low')
              ? 'low'
              : 'auto',
      });
  }, [live, models, value, onChange]);
  return (
    <div className="speech-controls">
      {
        <section className="speech-settings-section" aria-label="音频设备">
          <div className="speech-section-heading">
            <h3>音频设备</h3>
          </div>
          <div className="speech-device-grid">
            {(['system', 'microphone'] as AudioSource[]).map((source) => {
              const microphone = source === 'microphone';
              const enabled = value.options.sources.includes(source);
              return (
                <div className={`speech-device ${enabled ? '' : 'is-disabled'}`} key={source}>
                  <div className="speech-device-heading">
                    {microphone ? <AudioLines size={17} /> : <Volume2 size={17} />}
                    <strong>{microphone ? '面试者' : '面试官'}</strong>
                    <span>{microphone ? '麦克风' : '系统音频'}</span>
                  </div>
                  {choose(
                    microphone ? '麦克风设备' : '播放设备',
                    microphone && !enabled ? '__disabled__' : (value.options[source] ?? ''),
                    [
                      ...(microphone ? [{ id: '__disabled__', label: '不使用麦克风' }] : []),
                      {
                        id: '',
                        label: microphone ? '默认麦克风' : '默认播放设备',
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
                          sources: microphone
                            ? device === '__disabled__'
                              ? ['system']
                              : ['microphone', 'system']
                            : value.options.sources,
                        },
                      });
                    },
                    devicesLoading,
                    microphone ? '默认麦克风' : '默认播放设备',
                    devicesLoading
                      ? '正在读取设备…'
                      : microphone && enabled
                        ? error
                          ? '设备读取失败'
                          : devicesLoaded && !microphoneAvailable
                            ? value.options.microphone
                              ? '所选麦克风已不可用'
                              : '未检测到麦克风'
                            : undefined
                        : undefined,
                  )}
                  {microphone && enabled && (error || (devicesLoaded && !microphoneAvailable)) && (
                    <small className="speech-device-error" role="alert">
                      {error || '请连接麦克风，或选择“不使用麦克风”。'}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      }
      <ScreenCaptureSettings disabled={busy} />
      <section className="speech-settings-section speech-answer-settings" aria-label="模型设置">
        <div className="speech-section-heading">
          <h3>模型设置</h3>
        </div>
        <div className="speech-setting-row">
          <span className="speech-setting-label">回答模型</span>
          {live ? (
            choose(
              '面试回答模型',
              value.modelId,
              models,
              selectModel,
              !models.length,
              '正在读取模型…',
            )
          ) : (
            <span className="speech-current-answer">请先连接模型服务</span>
          )}
        </div>
        <div className="speech-setting-row speech-effort-row">
          <span className="speech-setting-label">思考强度</span>
          {choose(
            '面试回答思考强度',
            value.effort,
            ['auto' as const, ...efforts].map((id) => ({ id, label: effortLabels[id] })),
            (effort) => change({ effort: effort as ReasoningEffort | 'auto' }),
            !live || !efforts.length,
          )}
        </div>
      </section>
      {error && (
        <small role="alert" className="danger-text">
          {error}
        </small>
      )}
    </div>
  );
}

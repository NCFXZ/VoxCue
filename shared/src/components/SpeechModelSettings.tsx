import { t } from '../i18n';
import type {
  SpeechOptions,
  SpeechModelId,
  SpeechInferenceDevice,
} from '../../electron/contracts/speech';
import {
  speechModelLabels,
  speechSelection,
  speechCpuWarning,
} from '../../electron/contracts/speechSettings';
import { ChoiceMenu } from './ui/choice-menu';
import { InterviewReveal } from './InterviewReveal';
import { useComponentReady } from '../stores/components';
import { useEffect, useRef, type ReactNode } from 'react';
import { useSpeechHardware } from './useSpeechHardware';

export function SpeechModelSettings({
  options,
  onChange,
  disabled = false,
  allowParaformer = false,
  switchStatus,
  children,
}: {
  options: SpeechOptions;
  onChange(options: SpeechOptions): void;
  disabled?: boolean;
  allowParaformer?: boolean;
  switchStatus?: ReactNode;
  children?: ReactNode;
}) {
  const qwenReady = useComponentReady('qwen');
  const paraformerReady = useComponentReady('speech');
  const hardware = useSpeechHardware();
  const selected = speechSelection(options);
  const acceleration = hardware?.metal ? 'metal' : hardware?.cuda ? 'cuda' : undefined;
  const deviceAvailable =
    selected.inferenceDevice === 'cpu' || selected.inferenceDevice === acceleration;
  const fallbackAttempted = useRef(false);
  useEffect(() => {
    if (
      hardware &&
      !deviceAvailable &&
      !disabled &&
      !fallbackAttempted.current &&
      selected.speechModel === 'qwen' &&
      selected.inferenceDevice !== 'cpu'
    ) {
      fallbackAttempted.current = true;
      onChange({ ...options, inferenceDevice: 'cpu' });
    }
  }, [
    hardware,
    deviceAvailable,
    disabled,
    selected.speechModel,
    selected.inferenceDevice,
    options,
    onChange,
  ]);
  return (
    <div className="speech-model-settings">
      <div className="speech-model-group" role="group" aria-label={t('回答生成')}>
        {children}
      </div>
      <div
        className="speech-recognition-settings"
        role="group"
        aria-label={t('语音识别')}
        data-settings-highlight-group
      >
        <div className="speech-model-group">
          <div className="speech-setting-row" data-settings-target="speech-model">
            <span className="speech-setting-label">{t('语音模型')}</span>
            <ChoiceMenu<SpeechModelId>
              label={t('语音识别模型')}
              value={selected.speechModel}
              disabled={disabled && !allowParaformer}
              options={[
                {
                  value: 'paraformer',
                  label: t(speechModelLabels.paraformer) + (paraformerReady ? '' : t('（未下载）')),
                  disabled: !paraformerReady,
                },
                {
                  value: 'qwen',
                  label: t(speechModelLabels.qwen) + (qwenReady ? '' : t('（未下载）')),
                  disabled: disabled || !qwenReady || !hardware,
                },
              ]}
              onChange={(speechModel) =>
                onChange({
                  ...options,
                  speechModel,
                  inferenceDevice: speechModel === 'paraformer' ? 'cpu' : (acceleration ?? 'cpu'),
                })
              }
            />
          </div>
          <div className="speech-setting-row" data-settings-target="speech-device">
            <span className="speech-setting-label">{t('推理设备')}</span>
            <ChoiceMenu<SpeechInferenceDevice>
              label={t('语音推理设备')}
              value={deviceAvailable ? selected.inferenceDevice : 'cpu'}
              displayLabel={!hardware && !deviceAvailable ? t('读取中…') : undefined}
              disabled={
                disabled || !qwenReady || !acceleration || selected.speechModel === 'paraformer'
              }
              options={[
                ...(hardware?.cuda ? [{ value: 'cuda' as const, label: t('CUDA（推荐）') }] : []),
                ...(hardware?.metal ? [{ value: 'metal' as const, label: t('Metal（推荐）') }] : []),
                { value: 'cpu', label: 'CPU' },
              ]}
              onChange={(inferenceDevice) => onChange({ ...options, inferenceDevice })}
            />
          </div>
        </div>
        <InterviewReveal>
          {hardware && selected.speechModel === 'qwen' && selected.inferenceDevice === 'cpu' ? (
            <p className="speech-model-notices danger-text" role="alert">
              {t(speechCpuWarning)}
              {acceleration === 'metal'
                ? t('建议使用 Metal。')
                : acceleration === 'cuda'
                  ? t('建议使用 CUDA。')
                  : t('建议选择{0}。', [t(speechModelLabels.paraformer)])}
            </p>
          ) : null}
        </InterviewReveal>
        {switchStatus}
      </div>
    </div>
  );
}

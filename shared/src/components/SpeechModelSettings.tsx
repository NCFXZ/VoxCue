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
import { useComponentReady } from '../stores/components';
import { useEffect, useRef, type ReactNode } from 'react';
import { useSpeechHardware } from './useSpeechHardware';

export function SpeechModelSettings({
  options,
  onChange,
  disabled = false,
  switching,
  children,
}: {
  options: SpeechOptions;
  onChange(options: SpeechOptions): void;
  disabled?: boolean;
  switching?: 'loading' | 'waiting';
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
        <h4>{t('回答生成')}</h4>
        {children}
      </div>
      <div className="speech-model-group" role="group" aria-label={t('语音识别')}>
        <h4>{t('语音识别')}</h4>
        {switching && (
          <p className="speech-model-notices" role="status">
            {switching === 'loading'
              ? t('正在加载，原配置继续转写…')
              : t('已就绪，等待语音停顿后切换…')}
          </p>
        )}
        <div className="speech-setting-row">
          <span className="speech-setting-label">{t('语音模型')}</span>
          <ChoiceMenu<SpeechModelId>
            label={t('语音识别模型')}
            value={selected.speechModel}
            disabled={disabled || !hardware}
            options={[
              {
                value: 'paraformer',
                label: t(speechModelLabels.paraformer) + (paraformerReady ? '' : t('（未下载）')),
                disabled: !paraformerReady,
              },
              {
                value: 'qwen',
                label: t(speechModelLabels.qwen) + (qwenReady ? '' : t('（未下载）')),
                disabled: !qwenReady,
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
        <div className="speech-setting-row">
          <span className="speech-setting-label">{t('推理设备')}</span>
          <ChoiceMenu<SpeechInferenceDevice>
            label={t('语音推理设备')}
            value={deviceAvailable ? selected.inferenceDevice : 'cpu'}
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
        {selected.speechModel === 'qwen' && selected.inferenceDevice === 'cpu' && (
          <div className="speech-model-notices">
            <p className="danger-text" role="alert">
              {t(speechCpuWarning)}
              {hardware?.cuda ? t('建议使用 CUDA。') : ''}
              {hardware?.metal ? t('建议使用 Metal。') : ''}
              {!hardware?.cuda && !hardware?.metal
                ? t('建议选择{0}。', [t(speechModelLabels.paraformer)])
                : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

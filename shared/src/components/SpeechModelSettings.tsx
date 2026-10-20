import type {
  SpeechOptions,
  SpeechModelId,
  SpeechInferenceDevice,
} from '../../electron/contracts/speech';
import { speechModelLabels, speechSelection } from '../../electron/contracts/speechSettings';
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
      <div className="speech-model-group" role="group" aria-label="回答生成">
        <h4>回答生成</h4>
        {children}
      </div>
      <div className="speech-model-group" role="group" aria-label="语音识别">
        <h4>语音识别</h4>
        {switching && (
          <p className="speech-model-notices" role="status">
            {switching === 'loading' ? '正在加载，原配置继续转写…' : '已就绪，等待语音停顿后切换…'}
          </p>
        )}
        <div className="speech-setting-row">
          <span className="speech-setting-label">语音模型</span>
          <ChoiceMenu<SpeechModelId>
            label="语音识别模型"
            value={selected.speechModel}
            disabled={disabled || !hardware}
            options={[
              {
                value: 'paraformer',
                label: speechModelLabels.paraformer + (paraformerReady ? '' : '（未下载）'),
                disabled: !paraformerReady,
              },
              {
                value: 'qwen',
                label: speechModelLabels.qwen + (qwenReady ? '' : '（未下载）'),
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
          <span className="speech-setting-label">推理设备</span>
          <ChoiceMenu<SpeechInferenceDevice>
            label="语音推理设备"
            value={deviceAvailable ? selected.inferenceDevice : 'cpu'}
            disabled={
              disabled || !qwenReady || !acceleration || selected.speechModel === 'paraformer'
            }
            options={[
              ...(hardware?.cuda ? [{ value: 'cuda' as const, label: 'CUDA（推荐）' }] : []),
              ...(hardware?.metal ? [{ value: 'metal' as const, label: 'Metal（推荐）' }] : []),
              { value: 'cpu', label: 'CPU' },
            ]}
            onChange={(inferenceDevice) => onChange({ ...options, inferenceDevice })}
          />
        </div>
        {selected.speechModel === 'qwen' && selected.inferenceDevice === 'cpu' && (
          <div className="speech-model-notices">
            <p className="danger-text" role="alert">
              Qwen 使用 CPU 推理时性能可能不足，语音识别和对齐可能出现明显延迟。
              {hardware?.cuda ? '建议使用 CUDA。' : ''}
              {hardware?.metal ? '建议使用 Metal。' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

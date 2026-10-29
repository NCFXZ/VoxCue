import {
  componentPresentation,
  hasReadySpeechModel,
  type ComponentId,
} from '../../electron/contracts/components';
import type { SpeechOptions } from '../../electron/contracts/speech';
import { speechSelection, speechCpuWarning } from '../../electron/contracts/speechSettings';
import { useComponents } from '../stores/components';
import { ArrowUpRight } from './icons';
import { Button } from './ui/button';

export function ComponentsNotice({
  only,
  onSettings,
  onPerformanceSettings,
  speechOptions,
}: {
  only?: ComponentId;
  onSettings?(): void;
  onPerformanceSettings?(): void;
  speechOptions?: SpeechOptions;
}) {
  const state = useComponents((store) => store.state);
  if (!window.desktop?.components || !state) return null;
  const missing = state.items.filter(
    (item) =>
      item.phase !== 'ready' &&
      (only ? item.id === only : !item.optional) &&
      (item.id !== 'speech' || !hasReadySpeechModel(state)),
  );
  const selected = speechOptions ? speechSelection(speechOptions) : undefined;
  const cpuWarning =
    !only &&
    !missing.length &&
    selected?.speechModel === 'qwen' &&
    selected.inferenceDevice === 'cpu' &&
    state.items.some((item) => item.id === 'qwen' && item.phase === 'ready');
  if (!missing.length && !cpuWarning) return null;
  return (
    <aside
      className="components-notice"
      aria-label={cpuWarning ? '语音推理性能提示' : '本地组件提示'}
    >
      <div>
        <strong>
          {cpuWarning
            ? `${componentPresentation.qwen.label}性能受限`
            : only
              ? `${componentPresentation[missing[0].id].label}尚未就绪`
              : '本地组件尚未就绪'}
        </strong>
        <p>
          {cpuWarning ? (
            `${speechCpuWarning}可在设置中调整识别方式或推理设备。`
          ) : (
            <>
              {!only &&
                `${missing.map((item) => componentPresentation[item.id].label).join('、')}。`}
              请在设置中下载或查看进度。
            </>
          )}
        </p>
      </div>
      <Button
        variant="ghost"
        onClick={cpuWarning ? (onPerformanceSettings ?? onSettings) : onSettings}
      >
        前往设置 <ArrowUpRight size={14} />
      </Button>
    </aside>
  );
}

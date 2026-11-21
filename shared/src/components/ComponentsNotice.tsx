import { t } from '../i18n';
import {
  componentPresentation,
  hasReadySpeechModel,
  type ComponentId,
} from '../../electron/contracts/components';
import type { SpeechOptions } from '../../electron/contracts/speech';
import { speechSelection, speechCpuWarning } from '../../electron/contracts/speechSettings';
import { useComponents } from '../stores/components';
import type { OpenComponentSettings } from '../services/componentSettingsTargets';
import { SettingsNotice } from './SettingsNotice';

export function ComponentsNotice({
  only,
  onSettings,
  onPerformanceSettings,
  speechOptions,
}: {
  only?: ComponentId;
  onSettings?: OpenComponentSettings;
  onPerformanceSettings?(): void;
  speechOptions?: SpeechOptions;
}) {
  const state = useComponents((store) => store.state);
  const missing = state?.items.filter(
    (item) =>
      item.phase !== 'ready' &&
      (only ? item.id === only : !item.optional) &&
      (item.id !== 'speech' || !hasReadySpeechModel(state)),
  ) ?? [];
  const selected = speechOptions ? speechSelection(speechOptions) : undefined;
  const cpuWarning =
    !only &&
    !missing.length &&
    selected?.speechModel === 'qwen' &&
    selected.inferenceDevice === 'cpu' &&
    state?.items.some((item) => item.id === 'qwen' && item.phase === 'ready');
  const missingNames = [
    ...new Set(
      missing.map((item) =>
        item.id === 'rag' ? t(componentPresentation.rag.label) : t('语音识别'),
      ),
    ),
  ];
  return (
    <SettingsNotice
      visible={Boolean(window.desktop?.components && (missing.length || cpuWarning))}
      label={cpuWarning ? t('语音推理性能提示') : t('本地组件提示')}
      title={
        cpuWarning
          ? t('{0}性能受限', [t(componentPresentation.qwen.label)])
          : only && missingNames.length
            ? t('{0}尚未就绪', [missingNames[0]])
            : t('本地组件尚未就绪')
      }
      detail={
        cpuWarning
          ? t(speechCpuWarning) + t('可在设置中调整识别方式或推理设备。')
          : t('{0}组件未下载，请在设置中下载或查看进度', [missingNames.join(t('、'))])
      }
      onSettings={() => {
        if (cpuWarning && onPerformanceSettings) onPerformanceSettings();
        else onSettings?.({ required: missing.map((item) => item.id), anySpeech: !only });
      }}
    />
  );
}

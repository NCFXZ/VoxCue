import { t } from '../i18n';
import { useInterview } from '../stores/interview';
import { Button } from './ui/button';
import { Refresh, Settings } from './icons';

export function InterviewAudioRecovery({ onSettings }: { onSettings(): void }) {
  const state = useInterview();
  if (!state.speechError && !state.reconnecting) return null;
  return (
    <div className="audio-recovery" role="alert">
      <div>
        <strong>{state.reconnecting ? t('正在重新连接音频…') : t('音频采集已中断')}</strong>
        {!state.reconnecting && <p>{t(state.speechError)}</p>}
      </div>
      <Button
        variant="outline"
        disabled={state.reconnecting}
        onClick={() => void state.reconnectAudio()}
      >
        <Refresh size={15} />
        {state.reconnecting ? t('连接中…') : t('重新连接音频')}
      </Button>
      <Button variant="ghost" disabled={state.reconnecting} onClick={onSettings}>
        <Settings size={15} />
        {t('设置')}
      </Button>
    </div>
  );
}

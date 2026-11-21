import { t } from '../i18n';
import { useInterviewPanelState } from '../stores/interview';
import { Button } from './ui/button';
import { Refresh, Settings } from './icons';
import { InterviewNotice } from './InterviewNotice';
import { SpeechSwitchActions, switchDescription } from './SpeechSwitchActions';

export function InterviewAudioRecovery({ onSettings, container }: {
  onSettings(): void;
  container?: HTMLElement | null;
}) {
  const state = useInterviewPanelState();
  const phase = state.switchingSpeech ? state.speech.switching ?? 'loading' : undefined;
  const recovery = state.reconnecting ? 'reconnect' : state.speechError || null;
  return (
    <>
      <InterviewNotice noticeKey={phase ? 'speech-switch' : null} container={container} role="status"
        title={t('正在切换语音模型')}
        description={state.speechSwitchError ? t(state.speechSwitchError) : phase && switchDescription(phase)}>
        {phase && <SpeechSwitchActions phase={phase} id={state.speech.switchId} />}
      </InterviewNotice>
      <InterviewNotice noticeKey={phase ? null : recovery} container={container}
        title={state.reconnecting ? t('正在重新连接音频…') : t('音频采集已中断')}
        description={state.reconnecting ? undefined : t(state.speechError)}>
        <Button variant="outline" disabled={state.reconnecting} onClick={() => void state.reconnectAudio()}>
          <Refresh size={15} />
          {state.reconnecting ? t('连接中…') : t('重新连接音频')}
        </Button>
        <Button variant="ghost" disabled={state.reconnecting} onClick={onSettings}>
          <Settings size={15} />
          {t('设置')}
        </Button>
      </InterviewNotice>
    </>
  );
}

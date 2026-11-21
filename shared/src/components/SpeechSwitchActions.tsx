import { t } from '../i18n';
import { useInterview } from '../stores/interview';
import { Button } from './ui/button';
import { Loader, Play, X } from './icons';

type Phase = 'loading' | 'waiting';

export function switchDescription(phase: Phase) {
  return t(phase === 'loading' ? '正在加载，原配置继续转写…' : '已就绪，等待语音停顿后切换…');
}

export function SpeechSwitchActions({ phase, id }: { phase: Phase; id?: number }) {
  const control = useInterview((state) => state.controlSpeechSwitch);
  const loading = phase === 'loading' || id === undefined;
  return (
    <>
      <Button variant="outline" disabled={loading} aria-busy={loading}
        onClick={() => void control(id, 'now')}>
        {loading ? <Loader size={15} /> : <Play size={15} />}
        <span className="switch-action-label" data-size-label={t('立即切换')}>
          <span>{t(loading ? '加载中' : '立即切换')}</span>
        </span>
      </Button>
      <Button variant="ghost" onClick={() => void control(id, 'cancel')}>
        <X size={15} />{t('取消切换')}
      </Button>
    </>
  );
}

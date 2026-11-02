import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { AudioSource } from '../../electron/contracts/speech';
import { microphoneLevel, type AudioLevels } from '../services/audioLevel';
export type { AudioLevels } from '../services/audioLevel';
export function AudioInputMeters({
  levels,
  sources,
  active,
  only,
}: {
  levels: AudioLevels;
  sources: AudioSource[];
  active: boolean;
  only?: AudioSource;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <div className="audio-input-meters" aria-label={t('音频输入电平')}>
      {(only ? [only] : (['system', 'microphone'] as AudioSource[])).map((source) => {
        const enabled = sources.includes(source),
          value = levels[source];
        const level = active && value && now - value.at < 800 ? microphoneLevel(value.level) : 0;
        return (
          <div className="audio-meter-row" key={source}>
            <span>{source === 'system' ? t('系统声音') : t('我的麦克风')}</span>
            <div
              className="audio-meter-track"
              role="meter"
              aria-label={source === 'system' ? t('系统声音电平') : t('麦克风电平')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level)}
              aria-valuetext={
                !enabled ? t('未启用') : !active ? t('未采集') : `${Math.round(level)}%`
              }
            >
              <span style={{ width: `${level}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

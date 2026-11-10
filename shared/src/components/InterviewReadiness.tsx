import { t } from '../i18n';
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { useInterview } from '../stores/interview';
import { inputHoldMs } from '../services/audioLevel';
import {
  interviewReadiness,
  readinessLabels,
  readinessStates,
} from '../services/interviewReadiness';
import { Check, Loader, Minus, Warning } from './icons';
export function InterviewReadiness({ device }: { device?: ReactNode }) {
  const state = useInterview();
  const id = useId();
  const [, tick] = useState(0);
  const now = Date.now();
  const active =
    state.speech.state === 'running' &&
    Object.values(state.audioLevels).some(
      (sample) =>
        sample?.inputAt !== undefined &&
        now >= sample.inputAt &&
        now - sample.inputAt < inputHoldMs,
    );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => tick((value) => value + 1), 80);
    return () => clearInterval(timer);
  }, [active]);
  const badges = (['model', 'microphone', 'system'] as const).map((item) => {
    const status = interviewReadiness(item, state, now);
    const description = `${id}-${item}`;
    return (
      <span
        key={item}
        className="interview-ready-badge"
        data-state={status.kind}
        role="status"
        aria-live="off"
        aria-label={t('{0}：{1}', [t(readinessLabels[item]), t(readinessStates[status.kind])])}
        aria-describedby={description}
        tabIndex={0}
      >
        <span className="interview-ready-badge-label">{t(readinessLabels[item])}</span>
        <span className="interview-readiness-symbol" aria-hidden="true">
          <span data-active={status.kind === 'normal'}>
            <Check size={14} />
          </span>
          <span data-active={status.kind === 'error'}>
            <Warning size={14} />
          </span>
          <span data-active={status.kind === 'off' || status.kind === 'paused'}>
            <Minus size={14} />
          </span>
          <span
            data-active={status.kind === 'loading'}
            className={status.kind === 'loading' ? 'is-loading' : ''}
          >
            <Loader size={14} />
          </span>
          <span
            data-active={status.kind === 'input'}
            className="interview-readiness-level"
            style={{ '--input-level': Math.max(0.08, status.level / 100) } as CSSProperties}
          >
            {[0.55, 1, 0.72].map((height, index) => (
              <i key={index} style={{ height: `${height * 100}%` }} />
            ))}
          </span>
        </span>
        <span id={description} className="interview-badge-tooltip" role="tooltip">
          {t('{0}：{1}', [t(readinessLabels[item]), t(status.reason)])}
        </span>
      </span>
    );
  });
  return (
    <div className="interview-ready-badges" aria-label={t('音频状态')}>
      <div className="interview-ready-pair">
        {device}
        {badges[0]}
      </div>
      <div className="interview-ready-pair">
        {badges[1]}
        {badges[2]}
      </div>
    </div>
  );
}

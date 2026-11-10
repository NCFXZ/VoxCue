import { useId, useRef } from 'react';
import { t } from '../i18n';
import type { InterviewInputMode } from '../services/interviewInput';
import { Button } from './ui/button';

const choices = [
  { value: 'remote', label: '远程面试' },
  { value: 'transcription', label: '仅转录' },
] as const;

export function InterviewInputModeControl({
  value,
  onChange,
  disabled = false,
}: {
  value: InterviewInputMode;
  onChange(value: InterviewInputMode): void;
  disabled?: boolean;
}) {
  const label = useId();
  const controls = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <section className="interview-input-mode speech-setting-row">
      <h3 id={label}>{t('面试方式')}</h3>
      <div
        className="interview-input-segmented"
        role="radiogroup"
        aria-labelledby={label}
        data-selected-index={value === 'transcription' ? 1 : 0}
        aria-disabled={disabled}
      >
        <span className="interview-input-thumb" aria-hidden="true" />
        {choices.map((choice, index) => (
          <Button
            key={choice.value}
            ref={(node) => {
              controls.current[index] = node;
            }}
            type="button"
            variant="ghost"
            role="radio"
            aria-checked={value === choice.value}
            tabIndex={value === choice.value ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(choice.value)}
            onKeyDown={(event) => {
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 1
                    : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                      ? 1 - index
                      : undefined;
              if (next === undefined || disabled) return;
              event.preventDefault();
              controls.current[next]?.focus();
              onChange(choices[next].value);
            }}
          >
            {t(choice.label)}
          </Button>
        ))}
      </div>
    </section>
  );
}

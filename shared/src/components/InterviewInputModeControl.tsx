import { useId } from 'react';
import { t } from '../i18n';
import type { InterviewInputMode } from '../services/interviewInput';
import { SegmentedControl } from './ui/segmented-control';

const choices = [
  { value: 'remote', label: '远程面试' },
  { value: 'transcription', label: '现场面试' },
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
  return (
    <section className="interview-input-mode speech-setting-row">
      <h3 id={label}>{t('面试方式')}</h3>
      <SegmentedControl
        labelledBy={label}
        options={choices}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </section>
  );
}

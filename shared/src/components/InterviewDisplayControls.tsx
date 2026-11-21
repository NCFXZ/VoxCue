import { InterviewReveal } from './InterviewReveal';
import { t } from '../i18n';
import { useId, useState, type ReactNode } from 'react';
import { RangeSlider } from './ui/range-slider';
import {
  interviewFontSize,
  saveInterviewFontSize,
  useInterviewFontSize,
} from '../interviewTypography';
import { FontDecrease, FontIncrease } from './icons';
import {
  interviewTransparency,
  saveInterviewTransparency,
  useInterviewTransparency,
} from '../interviewAppearance';

function DisplaySlider({
  title,
  name,
  value,
  minimum,
  maximum,
  unit,
  startIcon,
  endIcon,
  onChange,
}: {
  title: string;
  name: string;
  value: number;
  minimum: number;
  maximum: number;
  unit: string;
  startIcon: ReactNode;
  endIcon: ReactNode;
  onChange(value: number): void;
}) {
  const id = useId();
  return (
    <div className="interview-display-setting speech-setting-row">
      <div className="interview-display-label speech-setting-label">
        <label htmlFor={id}>{title}</label>
        <output htmlFor={id}>
          {value}
          {unit}
        </output>
      </div>
      <div className="frosted-slider">
        <span className="display-slider-icon" aria-hidden="true">
          {startIcon}
        </span>
        <RangeSlider id={id} name={name} valueText={`${value}${unit}`} value={value}
          minimum={minimum} maximum={maximum} step={1} onChange={onChange} />
        <span className="display-slider-icon" aria-hidden="true">
          {endIcon}
        </span>
      </div>
    </div>
  );
}
export function InterviewDisplayControls() {
  const size = useInterviewFontSize();
  const transparency = useInterviewTransparency();
  const [error, setError] = useState('');
  const save = (operation: () => void) => {
    try {
      operation();
      setError('');
    } catch {
      setError('显示设置保存失败，请检查本地存储空间后重试。');
    }
  };
  return (
    <div className="interview-display-controls">
      <DisplaySlider
        title={t('字体大小')}
        name={t('面试字体大小')}
        value={size}
        minimum={interviewFontSize.minimum}
        maximum={interviewFontSize.maximum}
        unit="px"
        startIcon={<FontDecrease size={22} />}
        endIcon={<FontIncrease size={22} />}
        onChange={(value) => save(() => saveInterviewFontSize(value))}
      />
      <DisplaySlider
        title={t('背景透明度')}
        name={t('面试背景透明度')}
        value={transparency}
        minimum={interviewTransparency.minimum}
        maximum={interviewTransparency.maximum}
        unit="%"
        startIcon={<span className="display-opacity-icon is-opaque" />}
        endIcon={<span className="display-opacity-icon" />}
        onChange={(value) => save(() => saveInterviewTransparency(value))}
      />
      <InterviewReveal>{error ? (
        <p className="interview-display-error danger-text" role="alert">
          {t(error)}
        </p>
      ) : null}</InterviewReveal>
    </div>
  );
}

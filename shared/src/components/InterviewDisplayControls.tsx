import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import {
  interviewFontSize,
  saveInterviewFontSize,
  useInterviewFontSize,
} from '../interviewTypography';
import { saveInterviewTransparency, useInterviewTransparency } from '../interviewAppearance';
import { FontDecrease, FontIncrease } from './icons';
import { interviewTransparencyAvailable } from './ui/appearance-control';

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
    <div className="interview-display-setting">
      <div className="interview-display-label">
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
        <div
          className="frosted-slider-control"
          style={
            {
              '--slider-fill': `${((value - minimum) / (maximum - minimum)) * 100}%`,
            } as CSSProperties
          }
        >
          <span className="frosted-slider-track" aria-hidden="true">
            <span />
          </span>
          <input
            id={id}
            aria-label={name}
            aria-valuetext={`${value}${unit}`}
            type="range"
            min={minimum}
            max={maximum}
            step={1}
            value={value}
            onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
          />
        </div>
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
    <div
      className={`interview-display-controls${interviewTransparencyAvailable ? '' : ' single-setting'}`}
    >
      <DisplaySlider
        title="字体大小"
        name="面试字体大小"
        value={size}
        minimum={interviewFontSize.minimum}
        maximum={interviewFontSize.maximum}
        unit="px"
        startIcon={<FontDecrease size={22} />}
        endIcon={<FontIncrease size={22} />}
        onChange={(value) => save(() => saveInterviewFontSize(value))}
      />
      {interviewTransparencyAvailable && (
        <DisplaySlider
          title="背景透明度"
          name="面试背景透明度"
          value={transparency}
          minimum={0}
          maximum={100}
          unit="%"
          startIcon={<span className="frosted-endpoint is-solid" />}
          endIcon={<span className="frosted-endpoint" />}
          onChange={(value) => save(() => saveInterviewTransparency(value))}
        />
      )}
      {error && (
        <p className="danger-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

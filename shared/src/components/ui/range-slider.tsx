import type { CSSProperties } from 'react';

interface RangeSliderProps {
  id?: string;
  name: string;
  valueText: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  onChange(value: number): void;
}

export function RangeSlider({ id, name, valueText, value, minimum, maximum, step, onChange }: RangeSliderProps) {
  const fill = maximum > minimum ? (value - minimum) / (maximum - minimum) : 0;
  return (
    <div className="frosted-slider-control" style={{ '--slider-fill': `${fill * 100}%` } as CSSProperties}>
      <span className="frosted-slider-track" aria-hidden="true"><span /></span>
      <input id={id} aria-label={name} aria-valuetext={valueText} type="range"
        min={minimum} max={maximum} step={step} value={value}
        onChange={event => onChange(event.currentTarget.valueAsNumber)} />
    </div>
  );
}

import { useRef } from 'react';
import { t } from '../../i18n';
import { Button } from './button';

type Option<Value extends string> = { value: Value; label: string };

export function SegmentedControl<Value extends string>({
  labelledBy,
  options,
  value,
  onChange,
  disabled = false,
}: {
  labelledBy: string;
  options: readonly [Option<Value>, Option<Value>];
  value: Value;
  onChange(value: Value): void;
  disabled?: boolean;
}) {
  const controls = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div
      className="interview-input-segmented"
      role="radiogroup"
      aria-labelledby={labelledBy}
      data-selected-index={value === options[1].value ? 1 : 0}
      aria-disabled={disabled}
    >
      <span className="interview-input-thumb" aria-hidden="true" />
      {options.map((option, index) => (
        <Button
          key={option.value}
          ref={(node) => {
            controls.current[index] = node;
          }}
          type="button"
          variant="ghost"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option.value)}
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
            onChange(options[next].value);
          }}
        >
          {t(option.label)}
        </Button>
      ))}
    </div>
  );
}

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from '../icons';

export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
  className?: string;
  disabled?: boolean;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`choice-trigger ${className}`}
          aria-label={label}
          disabled={disabled}
        >
          <span title={selectedLabel}>{selectedLabel}</span>
          <ChevronDown size={14} />
        </button>
      </DropdownMenu.Trigger>
      {/* Stay in the native dialog's top layer, including keyboard focus. */}
      <DropdownMenu.Content className="dropdown-content choice-menu" align="end" sideOffset={6}>
        <DropdownMenu.RadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((option) => option.value === next);
            if (option) onChange(option.value);
          }}
        >
          {options.map((option) => (
            <DropdownMenu.RadioItem
              className="dropdown-item"
              key={option.value}
              value={option.value}
            >
              <span>{option.label}</span>
              <DropdownMenu.ItemIndicator className="choice-check">
                <Check size={14} />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

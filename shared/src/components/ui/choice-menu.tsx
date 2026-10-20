import * as DropdownMenu from './dropdown-menu';
import { useEffect, useRef, useState } from 'react';
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
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange(value: T): void;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [boundary, setBoundary] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const selectedLabel = options.find((option) => option.value === value)?.label;
  return (
    <DropdownMenu.Root
      open={open && !disabled}
      onOpenChange={(next) => {
        if (next) setBoundary(trigger.current?.closest('dialog') ?? null);
        setOpen(!disabled && next);
      }}
    >
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          ref={trigger}
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
      <DropdownMenu.Content
        className="dropdown-content choice-menu"
        align="end"
        sideOffset={6}
        collisionBoundary={boundary ?? undefined}
        collisionPadding={8}
      >
        <DropdownMenu.RadioGroup
          value={value}
          onValueChange={(next) => {
            if (disabled) return;
            const option = options.find((option) => option.value === next);
            if (option && !option.disabled) onChange(option.value);
          }}
        >
          {options.map((option) => (
            <DropdownMenu.RadioItem
              className="dropdown-item"
              key={option.value}
              value={option.value}
              disabled={disabled || option.disabled}
            >
              <span>{option.label}</span>
              <DropdownMenu.ItemIndicator className="choice-check dropdown-check">
                <Check size={14} />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

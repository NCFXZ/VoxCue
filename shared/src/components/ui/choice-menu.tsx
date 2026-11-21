import { t } from '../../i18n';
import * as DropdownMenu from './dropdown-menu';
import { useEffect, useRef, useState } from 'react';
import { Check } from '../icons';

export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
  disabled = false,
  displayLabel,
  sizeToOptions = false,
  extendOutsideDialog = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange(value: T): void;
  className?: string;
  disabled?: boolean;
  displayLabel?: string;
  sizeToOptions?: boolean;
  extendOutsideDialog?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [boundary, setBoundary] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const selectedLabel = displayLabel ?? options.find((option) => option.value === value)?.label;
  const host = extendOutsideDialog ? boundary : null;
  const menu = (
    <DropdownMenu.Content
      className="dropdown-content choice-menu"
      align="end"
      sideOffset={6}
      collisionBoundary={host ? host.ownerDocument.documentElement : boundary ?? undefined}
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
  );
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
          aria-label={t(label)}
          disabled={disabled}
        >
          <span
            title={selectedLabel}
            data-size-options={sizeToOptions ? options.map((option) => option.label).join('\n') : undefined}
          >
            {selectedLabel}
          </span>
          <DropdownMenu.TriggerChevron />
        </button>
      </DropdownMenu.Trigger>
      {/* Escape the scrolling body while retaining the native modal's focus and top layer. */}
      {host ? <DropdownMenu.Portal container={host}>{menu}</DropdownMenu.Portal> : menu}
    </DropdownMenu.Root>
  );
}

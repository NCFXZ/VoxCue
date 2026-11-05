import { useRef } from 'react';
import { t } from '../i18n';

export function VerificationCodeInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  function focus(index: number) {
    inputs.current[index]?.focus();
    inputs.current[index]?.select();
  }
  function replace(index: number, incoming: string) {
    const digits = incoming.replace(/\D/g, '').slice(0, 6);
    const next = value.padEnd(6, ' ').split('');
    const start = digits.length === 6 ? 0 : index;
    if (digits.length > 1) next.fill(' ', start);
    if (!digits) next[index] = ' ';
    else
      for (let offset = 0; offset < digits.length && start + offset < 6; offset++)
        next[start + offset] = digits[offset];
    onChange(next.join('').trimEnd());
    if (digits) focus(Math.min(start + digits.length, 5));
  }
  return (
    <div className="cloud-code-inputs">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            inputs.current[index] = node;
          }}
          id={index === 0 ? id : undefined}
          name={index === 0 ? 'code' : `code-${index + 1}`}
          aria-label={index === 0 ? undefined : t('验证码第{0}位', [index + 1])}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          required
          value={value[index]?.trim() ?? ''}
          disabled={disabled}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => replace(index, event.currentTarget.value)}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = event.clipboardData.getData('text');
            if (/\d/.test(pasted)) replace(index, pasted);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace') {
              event.preventDefault();
              const target = value[index]?.trim() ? index : Math.max(0, index - 1);
              replace(target, '');
              focus(target);
            } else if (event.key === 'Delete') {
              event.preventDefault();
              replace(index, '');
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              focus(Math.max(0, Math.min(5, index + (event.key === 'ArrowLeft' ? -1 : 1))));
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              focus(event.key === 'Home' ? 0 : 5);
            }
          }}
        />
      ))}
    </div>
  );
}

import { useRef, type InputHTMLAttributes, type RefObject } from 'react';
import { t } from '../../i18n';
import { PasswordVisibilityButton } from './password-visibility-button';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & {
  id: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  visible: boolean;
  onVisibilityChange(visible: boolean): void;
};

export function PasswordInput({ id, inputRef, visible, onVisibilityChange, ...input }: Props) {
  const localRef = useRef<HTMLInputElement>(null);
  const field = inputRef ?? localRef;
  return (
    <div className="cloud-password-field">
      <input
        {...input}
        id={id}
        ref={field}
        data-password-input=""
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        spellCheck={false}
      />
      <PasswordVisibilityButton
        visible={visible}
        label={t(visible ? '隐藏密码' : '显示密码')}
        aria-controls={id}
        disabled={input.disabled}
        onMouseDown={(event) => {
          if (document.activeElement === field.current) event.preventDefault();
        }}
        onClick={() => onVisibilityChange(!visible)}
      />
    </div>
  );
}

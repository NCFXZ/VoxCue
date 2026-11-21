import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Eye, EyeOff } from '../icons';
import './password-visibility-button.css';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> & {
  visible: boolean;
  label: string;
};

export const PasswordVisibilityButton = forwardRef<HTMLButtonElement, Props>(
  ({ visible, label, className, ...props }, ref) => {
    const Icon = visible ? EyeOff : Eye;
    return (
      <button
        {...props}
        ref={ref}
        className={['password-visibility-button', className].filter(Boolean).join(' ')}
        type="button"
        aria-label={label}
        aria-pressed={visible}
      >
        <Icon size={18} />
      </button>
    );
  },
);
PasswordVisibilityButton.displayName = 'PasswordVisibilityButton';

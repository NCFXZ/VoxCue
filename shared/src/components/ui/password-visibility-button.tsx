import { forwardRef, type ButtonHTMLAttributes } from 'react';
import * as icons from '../icons';
import { t } from '../../i18n';
import './password-visibility-button.css';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> & {
  visible: boolean;
  label: string;
};

export const PasswordVisibilityButton = forwardRef<HTMLButtonElement, Props>(
  ({ visible, label, className, ...props }, ref) => {
    const Icon = icons[visible ? 'EyeOff' : 'Eye'];
    return (
      <button
        {...props}
        ref={ref}
        className={['password-visibility-button', className].filter(Boolean).join(' ')}
        type="button"
        aria-label={label}
        aria-pressed={visible}
      >
        {Icon ? <Icon size={18} /> : t(visible ? '隐藏' : '显示')}
      </button>
    );
  },
);
PasswordVisibilityButton.displayName = 'PasswordVisibilityButton';

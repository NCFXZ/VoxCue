import type { CSSProperties } from 'react';
import { AlertOff24Regular } from '@fluentui/react-icons';
import { t } from '../i18n';
import { X } from './icons';
import { Button } from './ui/button';

export function DoNotShowAgainButton({ onClick, ariaLabel }: { onClick(): void; ariaLabel?: string }) {
  return (
    <Button variant="ghost" aria-label={ariaLabel} onClick={onClick}>
      <AlertOff24Regular aria-hidden={true} data-ui-icon={true}
        style={{ width: 16, height: 16, flexShrink: 0, '--icon-size': '16px' } as CSSProperties} />
      {t('不再显示')}
    </Button>
  );
}

export function NoticeCloseButton({ onClick, label, className }: {
  onClick(): void;
  label: string;
  className?: string;
}) {
  return (
    <Button variant="ghost" size="icon" className={className} data-reveal-on-hover aria-label={label} onClick={onClick}>
      <X size={14} />
    </Button>
  );
}

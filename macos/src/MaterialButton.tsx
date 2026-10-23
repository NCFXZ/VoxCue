import { useRef } from 'react';
import { Button } from '../../shared/src/components/ui/button';
import type { MaterialButtonProps } from '../../shared/src/platform/controls';
import { useGlassControl } from './useGlassControl';
import './sidebarGlass.css';

export function MaterialButton({ materialAction, className = '', ...props }: MaterialButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const { native } = useGlassControl(button, materialAction, !!props.disabled, () =>
    button.current?.click(),
  );
  return (
    <Button
      ref={button}
      {...props}
      className={`${className} macos-material-button${native ? ' is-native' : ''}`}
    />
  );
}

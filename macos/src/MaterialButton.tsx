import { useEffect, useRef, useState } from 'react';
import { Button } from '../../shared/src/components/ui/button';
import type { MaterialButtonProps } from '../../shared/src/platform/controls';
import { readLiquidGlass, subscribeLiquidGlass } from './liquidGlassPreference';
import { useGlassControl } from './useGlassControl';
import './sidebarGlass.css';

export function MaterialButton(props: MaterialButtonProps) {
  if (window.desktop?.presentation?.liquidGlass !== true) {
    const { materialAction: _action, ...button } = props;
    return <Button {...button} />;
  }
  return <NativeMaterialButton {...props} />;
}
function NativeMaterialButton({ materialAction, className = '', ...props }: MaterialButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [enabled, setEnabled] = useState(readLiquidGlass);
  useEffect(() => subscribeLiquidGlass(() => setEnabled(readLiquidGlass())), []);
  const { native } = useGlassControl(button, materialAction, enabled, !!props.disabled, () =>
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

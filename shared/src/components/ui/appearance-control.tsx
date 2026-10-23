import { useEffect, useState, type CSSProperties } from 'react';
import {
  readFrostedTransparency,
  saveFrostedTransparency,
  subscribeFrostedTransparency,
} from '../../frostedAppearance';

const nativeGlass =
  typeof window !== 'undefined' && window.desktop?.presentation?.liquidGlass === true;
export const interviewAlwaysDark = nativeGlass;
export const appearanceLabel = '毛玻璃透明度';
export const appearanceSettingAvailable = !nativeGlass;
export const interviewTransparencyAvailable = !nativeGlass;
export interface AppearanceControlProps {
  onError(error: string | null): void;
}

// The settings row and layout are shared. Each platform supplies its material.
export function AppearanceControl({ onError }: AppearanceControlProps) {
  const [value, setValue] = useState(readFrostedTransparency);
  useEffect(() => subscribeFrostedTransparency(setValue), []);
  return (
    <div className="frosted-adjustment">
      <div className="frosted-slider">
        <span className="frosted-endpoint is-solid" aria-hidden="true" />
        <div
          className="frosted-slider-control"
          style={{ '--slider-fill': `${value}%` } as CSSProperties}
        >
          <span className="frosted-slider-track" aria-hidden="true">
            <span />
          </span>
          <input
            id="frosted-transparency"
            type="range"
            min={0}
            max={100}
            step="any"
            value={value}
            aria-labelledby="appearance-effect-label"
            aria-valuetext={value === 0 ? '关闭毛玻璃' : `透明度 ${Math.round(value)}%`}
            onChange={(event) => {
              try {
                const next = event.currentTarget.valueAsNumber;
                saveFrostedTransparency(next);
                setValue(next);
                onError(null);
              } catch {
                onError('毛玻璃设置保存失败，请重试。');
              }
            }}
          />
        </div>
        <span className="frosted-endpoint" aria-hidden="true" />
      </div>
      <output htmlFor="frosted-transparency" className="frosted-value">
        {value === 0 ? '关' : `${Math.round(value)}%`}
      </output>
    </div>
  );
}

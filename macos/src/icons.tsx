import { useId, type CSSProperties } from 'react';
import symbols from './symbols.json';

const masks = import.meta.glob('../public/sf-symbols/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// Match the shared icon API and SVG layout so buttons, rotation, mirroring,
// currentColor and accessible names keep their existing behavior.
function icon(name: keyof typeof symbols, loading = false) {
  const source = masks[`../public/sf-symbols/${name}.png`];
  if (!source) throw Error(`Missing Mac system icon: ${name}. Run build:symbols.`);
  return function SystemIcon({ size = 20 }: { size?: number; strokeWidth?: number }) {
    const id = useId();
    return (
      <svg
        aria-hidden={true}
        data-ui-icon={true}
        className={loading ? 'ui-loader' : undefined}
        data-sf-symbol={symbols[name]}
        viewBox="0 0 24 24"
        style={
          { width: size, height: size, flexShrink: 0, '--icon-size': `${size}px` } as CSSProperties
        }
      >
        <defs>
          <mask
            id={id}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="24"
            height="24"
            style={{ maskType: 'alpha' }}
          >
            <image href={source} width="24" height="24" />
          </mask>
        </defs>
        {name === 'Loader' ? (
          <g mask={`url(#${id})`}>
            <g className="macos-loading-sweep">
              {Array.from({ length: 12 }, (_, index) => (
                <path
                  key={index}
                  d="M12 12 L12 -12 A24 24 0 0 1 24 -8.785 Z"
                  transform={`rotate(${index * 30} 12 12)`}
                  fill="currentColor"
                  opacity={0.15 + (index / 11) * 0.85}
                />
              ))}
            </g>
          </g>
        ) : (
          <rect width="24" height="24" fill="currentColor" mask={`url(#${id})`} />
        )}
      </svg>
    );
  };
}

export const AudioLines = icon('AudioLines');
export const DragGrip = icon('DragGrip');
export const ChevronLeft = icon('ChevronLeft');
export const ChevronRight = icon('ChevronRight');
export const Link = icon('Link');
export const Edit = icon('Edit');
export const Download = icon('Download');
export const Export = icon('Export');
export const PanelRight = icon('PanelRight');
export const Loader = icon('Loader', true);
export const Appearance = icon('Appearance');
export const Minus = icon('Minus');
export const Square = icon('Square');
export const X = icon('X');
export const MessageCirclePlus = icon('MessageCirclePlus');
export const History = icon('History');
export const Database = icon('Database');
export const Cloud = icon('Cloud');
export const CloudDone = icon('CloudDone');
export const CloudSync = icon('CloudSync');
export const CloudOff = icon('CloudOff');
export const CloudError = icon('CloudError');
export const ChevronsUpDown = icon('ChevronsUpDown');
export const Settings = icon('Settings');
export const LogOut = icon('LogOut');
export const PanelLeftClose = icon('PanelLeftClose');
export const PanelLeftOpen = icon('PanelLeftOpen');
export const ArrowUpRight = icon('ArrowUpRight');
export const ArrowUp = icon('ArrowUp');
export const Check = icon('Check');
export const Warning = icon('Warning');
export const ChevronDown = icon('ChevronDown');
export const CircleHelp = icon('CircleHelp');
export const Copy = icon('Copy');
export const MessageSquare = icon('MessageSquare');
export const Play = icon('Play');
export const Reset = icon('Reset');
export const Refresh = icon('Refresh');
export const Update = icon('Update');
export const Sparkles = icon('Sparkles');
export const Volume2 = icon('Volume2');
export const Monitor = icon('Monitor');
export const SystemTheme = icon('SystemTheme');
export const Moon = icon('Moon');
export const Sun = icon('Sun');
export const Globe = icon('Globe');
export const Folder = icon('Folder');
export const Paperclip = icon('Paperclip');
export const Plus = icon('Plus');
export const Trash = icon('Trash');
export const ChevronUp = icon('ChevronUp');
export const ShieldCheck = icon('ShieldCheck');
export const ShieldOff = icon('ShieldOff');
export const Expand = icon('Expand');
export const Person = icon('Person');
export const Screenshot = icon('Screenshot');
export const Save = icon('Save');
export const Search = icon('Search');
export const FileText = icon('FileText');
export const Eye = icon('Eye');
export const FontIncrease = icon('FontIncrease');
export const FontDecrease = icon('FontDecrease');

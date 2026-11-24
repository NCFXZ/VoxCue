import { useId, type CSSProperties } from 'react';
import symbols from './symbols.json';
import './control-symbols.css';

const masks = import.meta.glob('../public/sf-symbols/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const resolved = import.meta.glob('../public/sf-symbols/resolved.json', { eager: true, import: 'default' })[
  '../public/sf-symbols/resolved.json'
] as Partial<typeof symbols> | undefined;

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
        data-sf-symbol={resolved?.[name] ?? symbols[name]}
        data-sf-icon={name}
        fill="currentColor"
        viewBox="0 0 24 24"
        style={
          { width: size, height: size, flexShrink: 0, '--icon-size': `${size}px` } as CSSProperties
        }
      >
        <defs>
          {loading && (
            <linearGradient id={id + '-sweep'}>
              <stop offset="0%" stopColor="currentColor" stopOpacity=".12" />
              <stop offset="100%" stopColor="currentColor" />
            </linearGradient>
          )}
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
            <rect className="macos-loading-sweep" x="-5" y="-5" width="34" height="34" fill={`url(#${id}-sweep)`} />
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
export const LinkOff = icon('LinkOff');
export const Edit = icon('Edit');
export const Download = icon('Download');
export const Export = icon('Export');
export const ArrowRightLeft = icon('ArrowRightLeft');
export const PanelRight = icon('PanelRight');
export const Loader = icon('Loader', true);
export const Appearance = icon('Appearance');
export const Minus = icon('Minus');
export const Square = icon('Square');
export const X = icon('X');
export const Eye = icon('Eye');
export const EyeOff = icon('EyeOff');
export const CommentEdit = icon('CommentEdit');
export const History = icon('History');
export const Database = icon('Database');
export const CloudDone = icon('CloudDone');
export const CloudSync = icon('CloudSync');
export const CloudOffline = icon('CloudOffline');
export const CloudError = icon('CloudError');
export const ChevronsUpDown = icon('ChevronsUpDown');
export const Settings = icon('Settings');
export const Keyboard = icon('Keyboard');
export const LogIn = icon('LogIn');
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
export const Pause = icon('Pause');
export const Locate = icon('Locate');
export const Minimize = icon('Minimize');
export const BackTen = icon('BackTen');
export const ForwardTen = icon('ForwardTen');
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
export const Expand = icon('Expand');
export const Person = icon('Person');
export const personalInfoIconSize = 16;
export const Screenshot = icon('Screenshot');
export const Save = icon('Save');
export const FileText = icon('FileText');
export const BulletList = icon('BulletList');
export const ListSquare = icon('ListSquare');
export const FontIncrease = icon('FontIncrease');
export const FontDecrease = icon('FontDecrease');

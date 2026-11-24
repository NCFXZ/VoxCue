import type { ComponentType, CSSProperties } from 'react';
import {
  Mic24Regular,
  SpinnerIos20Regular,
  Color24Regular,
  Subtract24Regular,
  Square24Regular,
  Dismiss24Regular,
  Eye24Regular,
  EyeOff24Regular,
  Compose24Regular,
  History24Regular,
  Database24Regular,
  Settings24Regular,
  PanelLeftContract24Regular,
  PanelLeftExpand24Regular,
  ArrowUpRight24Regular,
  ArrowUp24Regular,
  Checkmark24Regular,
  Warning24Regular,
  ChevronDown24Regular,
  QuestionCircle24Regular,
  Copy24Regular,
  Chat24Regular,
  Play24Regular,
  Pause24Regular,
  MyLocation24Regular,
  ArrowMinimize24Regular,
  SkipBack1024Regular,
  SkipForward1024Regular,
  ArrowCounterclockwise24Regular,
  ArrowClockwise24Regular,
  ArrowSync24Regular,
  Sparkle24Regular,
  Speaker224Regular,
  Desktop24Regular,
  DarkTheme24Filled,
  WeatherMoon24Regular,
  WeatherSunny24Regular,
  Globe24Regular,
  Folder24Regular,
  Attach24Regular,
  Add24Regular,
  Delete24Regular,
  ChevronUp24Regular,
  ShieldCheckmark24Regular,
  ArrowMaximize24Regular,
  Person24Regular,
  ReOrderDotsVertical24Regular,
  ChevronLeft24Regular,
  ChevronRight24Regular,
  Link24Regular,
  LinkOff24Regular,
  Edit24Regular,
  ArrowDownload24Regular,
  ArrowExportLtr24Regular,
  ArrowSwap24Regular,
  PanelRightExpandRegular,
  Screenshot24Regular,
  Save24Regular,
  DocumentText24Regular,
  TextBulletList24Regular,
  TextBulletListSquare24Regular,
  FontIncreaseRegular,
  FontDecreaseRegular,
  CloudCheckmark24Regular,
  CloudSync24Regular,
  CloudError24Regular,
  Keyboard24Regular,
} from '@fluentui/react-icons';

// A consistent app-level API keeps the UI independent of its icon library.
function icon(
  Component: ComponentType<{
    style?: CSSProperties;
    'aria-hidden'?: boolean;
    'data-ui-icon'?: boolean;
    className?: string;
  }>,
  loading = false,
) {
  return ({ size = 20 }: { size?: number; strokeWidth?: number }) => (
    <Component
      aria-hidden={true}
      data-ui-icon={true}
      className={loading ? 'ui-loader' : undefined}
      style={
        { width: size, height: size, flexShrink: 0, '--icon-size': `${size}px` } as CSSProperties
      }
    />
  );
}
export const AudioLines = icon(Mic24Regular);
export const Keyboard = icon(Keyboard24Regular);
export const DragGrip = icon(ReOrderDotsVertical24Regular);
export const ChevronLeft = icon(ChevronLeft24Regular);
export const ChevronRight = icon(ChevronRight24Regular);
export const Link = icon(Link24Regular);
export const LinkOff = icon(LinkOff24Regular);
export const Edit = icon(Edit24Regular);
export const Download = icon(ArrowDownload24Regular);
export const Export = icon(ArrowExportLtr24Regular);
export const ArrowRightLeft = icon(ArrowSwap24Regular);
export const PanelRight = icon(PanelRightExpandRegular);
export const Loader = icon(SpinnerIos20Regular, true);
export const Appearance = icon(Color24Regular);
export const Minus = icon(Subtract24Regular);
export const Square = icon(Square24Regular);
export const X = icon(Dismiss24Regular);
export const Eye = icon(Eye24Regular);
export const EyeOff = icon(EyeOff24Regular);
export const CommentEdit = icon(Compose24Regular);
export const History = icon(History24Regular);
export const Database = icon(Database24Regular);
export const CloudDone = icon(CloudCheckmark24Regular);
export const CloudSync = icon(CloudSync24Regular);
export const CloudOffline = icon((props) => (
  <svg {...props} viewBox="0 0 24 24" fill="none">
    <path fill="currentColor" d="M7.2 4.52a6.36 6.36 0 0 1 4.72-1.92c3.36 0 5.88 2.28 6.08 5.36 2.5 0 4.48 1.92 4.48 4.28 0 2.16-1.36 3.84-3.28 4.28l-1.6-1.64c1.92 0 3.12-1.04 3.12-2.6 0-1.56-1.24-2.68-2.72-2.68h-.8a.88.88 0 0 1-.88-.88c0-2.56-1.92-4.4-4.4-4.4-1.36 0-2.56.56-3.32 1.6Z" />
    <path stroke="currentColor" strokeWidth="1.76" strokeLinecap="round" d="M7.2 8.88H5.86a3.46 3.46 0 0 0 0 6.92h8.86M2.4 3.6l16.92 16.92" />
  </svg>
));
export const CloudError = icon(CloudError24Regular);

export const ChevronsUpDown = icon(ChevronDown24Regular);
export const Settings = icon(Settings24Regular);
export { LogIn } from './LoginIcon';
export { LogOut } from './LogoutIcon';
export const PanelLeftClose = icon(PanelLeftContract24Regular);
export const PanelLeftOpen = icon(PanelLeftExpand24Regular);
export const ArrowUpRight = icon(ArrowUpRight24Regular);
export const ArrowUp = icon(ArrowUp24Regular);
export const Check = icon(Checkmark24Regular);
export const Warning = icon(Warning24Regular);
export const ChevronDown = icon(ChevronDown24Regular);
export const CircleHelp = icon(QuestionCircle24Regular);
export const Copy = icon(Copy24Regular);
export const MessageSquare = icon(Chat24Regular);

export const Play = icon(Play24Regular);
export const Pause = icon(Pause24Regular);
export const Locate = icon(MyLocation24Regular);
export const Minimize = icon(ArrowMinimize24Regular);
export const BackTen = icon(SkipBack1024Regular);
export const ForwardTen = icon(SkipForward1024Regular);
export const Reset = icon(ArrowCounterclockwise24Regular);
export const Refresh = icon(ArrowClockwise24Regular);
export const Update = icon(ArrowSync24Regular);
export const Sparkles = icon(Sparkle24Regular);
export const Volume2 = icon(Speaker224Regular);
export const Monitor = icon(Desktop24Regular);
export const SystemTheme = icon(DarkTheme24Filled);
export const Moon = icon(WeatherMoon24Regular);
export const Sun = icon(WeatherSunny24Regular);
export const Globe = icon(Globe24Regular);
export const Folder = icon(Folder24Regular);
export const Paperclip = icon(Attach24Regular);
export const Plus = icon(Add24Regular);
export const Trash = icon(Delete24Regular);
export const ChevronUp = icon(ChevronUp24Regular);
export const ShieldCheck = icon(ShieldCheckmark24Regular);
export const Expand = icon(ArrowMaximize24Regular);
export const Person = icon(Person24Regular);
export const personalInfoIconSize = 16;
export const Screenshot = icon(Screenshot24Regular);
export const Save = icon(Save24Regular);
export const FileText = icon(DocumentText24Regular);
export const BulletList = icon(TextBulletList24Regular);
export const ListSquare = icon(TextBulletListSquare24Regular);
export const FontIncrease = icon(FontIncreaseRegular);
export const FontDecrease = icon(FontDecreaseRegular);

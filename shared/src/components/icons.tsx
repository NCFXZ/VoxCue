import type { ComponentType, CSSProperties } from 'react';
import {
  Mic24Regular,
  SpinnerIos20Regular,
  Color24Regular,
  Subtract24Regular,
  Square24Regular,
  Dismiss24Regular,
  ChatAdd24Regular,
  History24Regular,
  Database24Regular,
  Settings24Regular,
  SignOut24Regular,
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
  ArrowCounterclockwise24Regular,
  ArrowClockwise24Regular,
  ArrowSync24Regular,
  Sparkle24Regular,
  Speaker224Regular,
  Desktop24Regular,
  WeatherMoon24Regular,
  WeatherSunny24Regular,
  Globe24Regular,
  Folder24Regular,
  Attach24Regular,
  Add24Regular,
  Delete24Regular,
  ChevronUp24Regular,
  ShieldCheckmark24Regular,
  ShieldDismiss24Regular,
  ArrowMaximize24Regular,
  Person24Regular,
  ReOrderDotsVertical24Regular,
  ChevronLeft24Regular,
  ChevronRight24Regular,
  Link24Regular,
  Edit24Regular,
  ArrowDownload24Regular,
  ArrowExportLtr24Regular,
  PanelRightExpandRegular,
  Screenshot24Regular,
  Save24Regular,
  DocumentText24Regular,
  FontIncreaseRegular,
  FontDecreaseRegular,
  Cloud24Regular,
  CloudCheckmark24Regular,
  CloudSync24Regular,
  CloudOff24Regular,
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
export const Edit = icon(Edit24Regular);
export const Download = icon(ArrowDownload24Regular);
export const Export = icon(ArrowExportLtr24Regular);
export const PanelRight = icon(PanelRightExpandRegular);
export const Loader = icon(SpinnerIos20Regular, true);
export const Appearance = icon(Color24Regular);
export const Minus = icon(Subtract24Regular);
export const Square = icon(Square24Regular);
export const X = icon(Dismiss24Regular);
export const MessageCirclePlus = icon(ChatAdd24Regular);
export const History = icon(History24Regular);
export const Database = icon(Database24Regular);
export const Cloud = icon(Cloud24Regular);
export const CloudDone = icon(CloudCheckmark24Regular);
export const CloudSync = icon(CloudSync24Regular);
export const CloudOff = icon(CloudOff24Regular);
export const CloudError = icon(CloudError24Regular);

export const ChevronsUpDown = icon(ChevronDown24Regular);
export const Settings = icon(Settings24Regular);
export const LogOut = icon(SignOut24Regular);
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
export const Reset = icon(ArrowCounterclockwise24Regular);
export const Refresh = icon(ArrowClockwise24Regular);
export const Update = icon(ArrowSync24Regular);
export const Sparkles = icon(Sparkle24Regular);
export const Volume2 = icon(Speaker224Regular);
export const Monitor = icon(Desktop24Regular);
export const SystemTheme = Monitor;
export const Moon = icon(WeatherMoon24Regular);
export const Sun = icon(WeatherSunny24Regular);
export const Globe = icon(Globe24Regular);
export const Folder = icon(Folder24Regular);
export const Paperclip = icon(Attach24Regular);
export const Plus = icon(Add24Regular);
export const Trash = icon(Delete24Regular);
export const ChevronUp = icon(ChevronUp24Regular);
export const ShieldCheck = icon(ShieldCheckmark24Regular);
export const ShieldOff = icon(ShieldDismiss24Regular);
export const Expand = icon(ArrowMaximize24Regular);
export const Person = icon(Person24Regular);
export const Screenshot = icon(Screenshot24Regular);
export const Save = icon(Save24Regular);
export const FileText = icon(DocumentText24Regular);
export const FontIncrease = icon(FontIncreaseRegular);
export const FontDecrease = icon(FontDecreaseRegular);

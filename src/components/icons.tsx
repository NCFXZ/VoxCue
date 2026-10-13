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
  ChevronUpDown24Regular,
  Settings24Regular,
  SignOut24Regular,
  PanelLeftContract24Regular,
  PanelLeftExpand24Regular,
  ArrowUpRight24Regular,
  ArrowUp24Regular,
  Checkmark24Regular,
  ChevronDown24Regular,
  QuestionCircle24Regular,
  Copy24Regular,
  Chat24Regular,
  Play24Regular,
  ArrowCounterclockwise24Regular,
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
  ArrowMinimize24Regular,
  Person24Regular,
  ReOrderDotsVertical24Regular,
  ChevronLeft24Regular,
  DocumentArrowDown24Regular,
  PanelRightExpandRegular,
} from '@fluentui/react-icons';

// A consistent app-level API keeps the UI independent of its icon library.
function icon(Component: ComponentType<{ style?: CSSProperties; 'aria-hidden'?: boolean }>) {
  return ({ size = 20 }: { size?: number; strokeWidth?: number }) => (
    <Component aria-hidden={true} style={{ width: size, height: size, flexShrink: 0 }} />
  );
}
export const AudioLines = icon(Mic24Regular);
export const DragGrip = icon(ReOrderDotsVertical24Regular);
export const ChevronLeft = icon(ChevronLeft24Regular);
export const Download = icon(DocumentArrowDown24Regular);
export const PanelRight = icon(PanelRightExpandRegular);
export const Loader = icon(SpinnerIos20Regular);
export const Appearance = icon(Color24Regular);
export const Minus = icon(Subtract24Regular);
export const Square = icon(Square24Regular);
export const X = icon(Dismiss24Regular);
export const MessageCirclePlus = icon(ChatAdd24Regular);
export const History = icon(History24Regular);
export const Database = icon(Database24Regular);

export const ChevronsUpDown = icon(ChevronUpDown24Regular);
export const Settings = icon(Settings24Regular);
export const LogOut = icon(SignOut24Regular);
export const PanelLeftClose = icon(PanelLeftContract24Regular);
export const PanelLeftOpen = icon(PanelLeftExpand24Regular);
export const ArrowUpRight = icon(ArrowUpRight24Regular);
export const ArrowUp = icon(ArrowUp24Regular);
export const Check = icon(Checkmark24Regular);
export const ChevronDown = icon(ChevronDown24Regular);
export const CircleHelp = icon(QuestionCircle24Regular);
export const Copy = icon(Copy24Regular);
export const MessageSquare = icon(Chat24Regular);

export const Play = icon(Play24Regular);
export const RotateCcw = icon(ArrowCounterclockwise24Regular);
export const Sparkles = icon(Sparkle24Regular);
export const Volume2 = icon(Speaker224Regular);
export const Monitor = icon(Desktop24Regular);
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
export const Shrink = icon(ArrowMinimize24Regular);
export const Person = icon(Person24Regular);

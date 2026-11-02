import { translateUI } from '../electron/contracts/uiLanguage';
import { useGeneralSettings } from './stores/generalSettings';

export const uiLocale = () => useGeneralSettings.getState().language;
export const t = (source: string | null | undefined, values?: readonly unknown[]) =>
  translateUI(source ?? '', uiLocale(), values);

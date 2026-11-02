import { create } from 'zustand';
import {
  isUILanguage,
  systemUILanguage,
  type UILanguage,
} from '../../electron/contracts/uiLanguage';

const languageKey = 'voxcue-language-v1';
function readLanguage(): UILanguage {
  try {
    const saved = localStorage.getItem(languageKey);
    if (isUILanguage(saved)) return saved;
  } catch {
    // An unavailable preference store must not prevent the login page from loading.
  }
  return typeof window !== 'undefined' && window.desktop?.systemLanguage
    ? window.desktop.systemLanguage
    : systemUILanguage(typeof navigator === 'undefined' ? undefined : navigator.language);
}

export const useGeneralSettings = create<{
  language: UILanguage;
  error: string | null;
  setLanguage(language: UILanguage): void;
  connect(): () => void;
}>((set) => ({
  language: readLanguage(),
  error: null,
  setLanguage(language) {
    if (!isUILanguage(language)) return;
    try {
      localStorage.setItem(languageKey, language);
      set({ language, error: null });
    } catch {
      set({ error: '语言设置保存失败，请重试。' });
    }
  },
  connect() {
    const stored = (event: StorageEvent) => {
      if (event.key === languageKey || event.key === null) set({ language: readLanguage() });
    };
    window.addEventListener('storage', stored);
    return () => window.removeEventListener('storage', stored);
  },
}));

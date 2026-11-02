import React, { useEffect, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { FloatingInterview } from './components/FloatingInterview';
import './styles.css';
import { installPlatformMaterials } from './platform/materials';
import { useSystemAccent } from './systemAccent';
import { applyFrostedAppearance, useFrostedAppearance } from './frostedAppearance';
import { useGeneralSettings } from './stores/generalSettings';

// Set the presentation scope on the document so portals and the interview window share it.
document.documentElement.classList.add('desktop-ui');
document.documentElement.lang = useGeneralSettings.getState().language;
if (location.hash === '#interview') document.documentElement.classList.add('dark');
applyFrostedAppearance();
const disposeMaterials = installPlatformMaterials();
if (import.meta.hot) import.meta.hot.dispose(disposeMaterials);
document.documentElement.classList.toggle(
  'frosted-ui',
  window.desktop?.presentation?.frostedTransparency === true,
);
document.documentElement.classList.toggle(
  'mouse-passthrough-ui',
  window.desktop?.presentation?.interviewMousePassthrough === true,
);

function WindowContent() {
  const language = useGeneralSettings((state) => state.language);
  useEffect(() => useGeneralSettings.getState().connect(), []);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    void window.desktop
      ?.setUILanguage(language)
      .catch(() => useGeneralSettings.setState({ error: '无法同步界面语言，请重试。' }));
  }, [language]);
  useSystemAccent();
  useFrostedAppearance();
  return location.hash === '#interview' ? <FloatingInterview /> : <App />;
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WindowContent />
  </React.StrictMode>,
);

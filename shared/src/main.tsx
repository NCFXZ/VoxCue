import React, { useEffect, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { FloatingInterview } from './components/FloatingInterview';
import { FloatingInterviewShortcuts } from './components/FloatingInterviewShortcuts';
import './styles.css';
import { installPlatformMaterials } from './platform/materials';
import { useSystemAccent } from './systemAccent';
import { applyFrostedAppearance, useFrostedAppearance } from './frostedAppearance';
import { useGeneralSettings } from './stores/generalSettings';
import { useRemoteConnection } from './stores/remoteConnection';
import { useShortcuts } from './stores/shortcuts';
import { connectRemoteInterview } from './services/remoteInterview';
import { RemoteConnectionDialogs } from './components/RemoteConnection';

// Set the presentation scope on the document so portals and the interview window share it.
document.documentElement.classList.add('desktop-ui');
document.documentElement.lang = useGeneralSettings.getState().language;
const shortcutsWindow = location.hash === '#interview-shortcuts';
if (location.hash === '#interview' || shortcutsWindow)
  document.documentElement.classList.add('dark');
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
  useEffect(() => location.hash === '#login' ? undefined : useShortcuts.getState().connect(), []);
  const language = useGeneralSettings((state) => state.language);
  useEffect(() => useGeneralSettings.getState().connect(), []);
  useEffect(() => {
    if (shortcutsWindow || location.hash === '#login') return;
    const disconnectEvents = useRemoteConnection.getState().connectEvents();
    const disconnectInterview =
      location.hash === '#interview' ? connectRemoteInterview() : undefined;
    return () => {
      disconnectEvents();
      disconnectInterview?.();
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    if (shortcutsWindow) return;
    void window.desktop
      ?.setUILanguage(language)
      .catch(() => useGeneralSettings.setState({ error: '无法同步界面语言，请重试。' }));
  }, [language]);
  useSystemAccent();
  useFrostedAppearance();
  if (shortcutsWindow) return <FloatingInterviewShortcuts />;
  return (
    <>
      {location.hash === '#interview' ? <FloatingInterview /> : <App />}
      {location.hash !== '#login' && location.hash !== '#interview' && <RemoteConnectionDialogs />}
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WindowContent />
  </React.StrictMode>,
);

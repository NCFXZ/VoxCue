import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { FloatingInterview } from './components/FloatingInterview';
import './styles.css';
import { installPlatformMaterials } from './platform/materials';
import { useSystemAccent } from './systemAccent';
import { applyFrostedAppearance, useFrostedAppearance } from './frostedAppearance';

// Set the presentation scope on the document so portals and the interview window share it.
document.documentElement.classList.add('desktop-ui');
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
  useSystemAccent();
  useFrostedAppearance();
  return location.hash === '#interview' ? <FloatingInterview /> : <App />;
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WindowContent />
  </React.StrictMode>,
);

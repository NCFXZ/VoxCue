import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { FloatingInterview } from './components/FloatingInterview';
import './styles.css';
import { useSystemAccent } from './systemAccent';
function WindowContent() {
  useSystemAccent();
  return location.hash === '#interview' ? <FloatingInterview /> : <App />;
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WindowContent />
  </React.StrictMode>,
);

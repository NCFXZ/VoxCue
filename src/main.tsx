import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { FloatingInterview } from './components/FloatingInterview';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.hash === '#interview' ? <FloatingInterview /> : <App />}
  </React.StrictMode>,
);

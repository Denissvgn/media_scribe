import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Suppress benign Vite HMR/WebSocket connection errors expected in the development sandbox environment
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reasonStr = event.reason ? String(event.reason.message || event.reason) : '';
    if (reasonStr.includes('WebSocket') || reasonStr.includes('vite') || reasonStr.includes('hmr')) {
      event.preventDefault();
      console.debug('Suppressed benign sandbox HMR connection event:', reasonStr);
    }
  });

  window.addEventListener('error', (event) => {
    const errorStr = event.message || '';
    if (errorStr.includes('WebSocket') || errorStr.includes('vite')) {
      event.preventDefault();
    }
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

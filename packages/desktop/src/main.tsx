import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window && 'invoke' in (window.__TAURI_INTERNALS__ as object))) {
  await import('./dev-mock');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

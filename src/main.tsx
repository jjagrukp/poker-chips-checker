import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from '@/app/App';
import { appStatus } from '@/infrastructure/pwa/app-status';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Offline shell (D31). A new version never reloads by itself: a running clock is never interrupted.
const updateServiceWorker = registerSW({
  onNeedRefresh: () => appStatus.set({ updateReady: true }),
});
appStatus.setUpdater(() => void updateServiceWorker(true));
appStatus.watchInstall(window);
// Tab locks are released on pagehide, so a page restored from the back/forward cache starts afresh.
window.addEventListener('pageshow', (e) => e.persisted && window.location.reload());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

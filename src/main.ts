import './styles.css';
import { t } from './i18n';
import { app, initApp, type View } from './stores/app';
import { closeSheet, showToast } from './ui';
import { initChat } from './views/chat';
import { initHome, openAddSheet } from './views/home';
import { initSettings } from './views/settings';
import { initState } from './views/state';
import { initStats } from './views/stats';

const NAV: { view: View; icon: string; label: string }[] = [
  { view: 'home', icon: '📝', label: t('nav.home') },
  { view: 'chat', icon: '🤝', label: t('nav.chat') },
  { view: 'state', icon: '🧭', label: t('nav.state') },
  { view: 'stats', icon: '📊', label: t('nav.stats') },
  { view: 'settings', icon: '⚙️', label: t('nav.settings') },
];

document.querySelector<HTMLElement>('#app')!.innerHTML = `
  <header class="app-bar">
    <h1>MindVault</h1>
    <div class="tagline">${t('app.tagline')}</div>
  </header>
  <div class="view-container">
    ${NAV.map(({ view }) => `<section class="view" id="view-${view}"></section>`).join('')}
  </div>
  <button class="fab" id="fab" aria-label="${t('sheet.new')}">+</button>
  <nav class="bottom-nav">
    ${NAV.map(
      ({ view, icon, label }) =>
        `<button class="nav-btn" data-view="${view}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`,
    ).join('')}
  </nav>
  <div class="sheet-backdrop" id="backdrop"></div>
  <div class="sheet" id="sheet"></div>
  <div class="toast" id="toast"></div>`;

initHome(document.getElementById('view-home')!);
initChat(document.getElementById('view-chat')!);
initState(document.getElementById('view-state')!);
initStats(document.getElementById('view-stats')!);
initSettings(document.getElementById('view-settings')!);

function switchView(view: View) {
  app.update((s) => ({ ...s, view }));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${view}`)!.classList.add('active');
  document.querySelectorAll<HTMLElement>('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.getElementById('fab')!.style.display = view === 'home' ? 'flex' : 'none';
}

document.querySelectorAll<HTMLElement>('.nav-btn').forEach((b) =>
  b.addEventListener('click', () => switchView(b.dataset.view as View)),
);
document.getElementById('fab')!.addEventListener('click', openAddSheet);
document.getElementById('backdrop')!.addEventListener('click', closeSheet);
switchView('home');

window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => app.update((s) => ({ ...s }))); // перерисовать с темой

if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

void initApp().then(() => {
  const { migratedCount } = app.get();
  if (migratedCount > 0) {
    showToast(`Перенесено из старой версии: ${migratedCount}`);
  }
});

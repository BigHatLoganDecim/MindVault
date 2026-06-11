import { t } from '../i18n';
import { app, exportData, importData, updateSettings, wipeAllData, type AppState } from '../stores/app';
import { showToast } from '../ui';

let root: HTMLElement;

export function initSettings(container: HTMLElement) {
  root = container;
  root.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:14px;">${t('settings.title')}</h2>

    <div class="card-block">
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.reminder')}</div><div class="setting-desc">${t('settings.reminderDesc')}</div></div>
        <button class="toggle" id="tg-reminder"></button>
      </div>
      <div class="setting-row">
        <div class="setting-label">${t('settings.reminderTime')}</div>
        <input type="time" class="time-input" id="reminder-time">
      </div>
      <div class="setting-row">
        <div class="setting-label">${t('settings.theme')}</div>
        <select class="select-input" id="theme-select">
          <option value="auto">${t('settings.themeAuto')}</option>
          <option value="light">${t('settings.themeLight')}</option>
          <option value="dark">${t('settings.themeDark')}</option>
        </select>
      </div>
    </div>

    <div class="section-title">ИИ</div>
    <div class="card-block">
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.ai')}</div><div class="setting-desc">${t('settings.aiDesc')}</div></div>
        <button class="toggle" id="tg-ai"></button>
      </div>
      <div class="setting-row">
        <div class="setting-label">${t('settings.apiUrl')}</div>
        <input type="url" class="text-input" id="api-url" placeholder="https://...">
      </div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.toneAnalysis')}</div><div class="setting-desc">${t('settings.toneDesc')}</div></div>
        <button class="toggle" id="tg-tone"></button>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.echoThreshold')}</div><div class="setting-desc" id="echo-val"></div></div>
        <input type="range" min="0.7" max="0.95" step="0.01" id="echo-threshold" style="max-width:45%;">
      </div>
    </div>

    <div class="section-title">${t('settings.data')}</div>
    <div class="card-block">
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.export')}</div><div class="setting-desc">${t('settings.exportDesc')}</div></div>
        <button class="btn btn-secondary" id="export-btn" style="flex:initial;padding:8px 14px;">${t('settings.download')}</button>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.import')}</div><div class="setting-desc">${t('settings.importDesc')}</div></div>
        <button class="btn btn-secondary" id="import-btn" style="flex:initial;padding:8px 14px;">${t('settings.upload')}</button>
        <input type="file" id="import-file" accept=".json" style="display:none;">
      </div>
      <div class="setting-row">
        <div><div class="setting-label" style="color:var(--danger);">${t('settings.clear')}</div><div class="setting-desc">${t('settings.clearDesc')}</div></div>
        <button class="btn btn-secondary" id="clear-btn" style="flex:initial;padding:8px 14px;color:var(--danger);">${t('settings.clearBtn')}</button>
      </div>
    </div>
    <div style="text-align:center;margin-top:24px;font-size:12px;color:var(--text-secondary);">MindVault v0.2</div>`;

  bind();
  app.subscribe(render);
  render(app.get());
}

function bind() {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;

  q('#tg-reminder').addEventListener('click', async () => {
    const on = !app.get().settings.reminderEnabled;
    if (on && 'Notification' in window && Notification.permission !== 'granted') {
      await Notification.requestPermission();
    }
    void updateSettings({ reminderEnabled: on });
  });
  q<HTMLInputElement>('#reminder-time').addEventListener('change', (e) =>
    updateSettings({ reminderTime: (e.target as HTMLInputElement).value }),
  );
  q<HTMLSelectElement>('#theme-select').addEventListener('change', (e) =>
    updateSettings({ theme: (e.target as HTMLSelectElement).value as 'auto' | 'light' | 'dark' }),
  );
  q('#tg-ai').addEventListener('click', () =>
    updateSettings({ aiEnabled: !app.get().settings.aiEnabled }),
  );
  q<HTMLInputElement>('#api-url').addEventListener('change', (e) =>
    updateSettings({ apiUrl: (e.target as HTMLInputElement).value.trim() }),
  );
  q('#tg-tone').addEventListener('click', () =>
    updateSettings({ toneAnalysisEnabled: !app.get().settings.toneAnalysisEnabled }),
  );
  q<HTMLInputElement>('#echo-threshold').addEventListener('change', (e) =>
    updateSettings({ echoThreshold: Number((e.target as HTMLInputElement).value) }),
  );

  q('#export-btn').addEventListener('click', async () => {
    const blob = new Blob([await exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mindvault-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  q('#import-btn').addEventListener('click', () => q<HTMLInputElement>('#import-file').click());
  q<HTMLInputElement>('#import-file').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const count = await importData(await file.text());
      showToast(`${t('settings.imported')}: ${count}`);
    } catch {
      showToast(t('settings.importError'));
    }
  });

  q('#clear-btn').addEventListener('click', async () => {
    if (confirm(`${t('settings.clear')}? ${t('settings.clearDesc')}`)) {
      await wipeAllData();
      showToast(t('settings.cleared'));
    }
  });
}

function render(s: AppState) {
  if (!s.ready) return;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  q('#tg-reminder').classList.toggle('on', s.settings.reminderEnabled);
  q<HTMLInputElement>('#reminder-time').value = s.settings.reminderTime;
  q<HTMLSelectElement>('#theme-select').value = s.settings.theme;
  q('#tg-ai').classList.toggle('on', s.settings.aiEnabled);
  q<HTMLInputElement>('#api-url').value = s.settings.apiUrl;
  q('#tg-tone').classList.toggle('on', s.settings.toneAnalysisEnabled);
  q<HTMLInputElement>('#echo-threshold').value = String(s.settings.echoThreshold);
  q('#echo-val').textContent = `порог схожести: ${s.settings.echoThreshold}`;
}

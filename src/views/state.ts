import { t } from '../i18n';
import { buildInsights, hasEnoughData } from '../services/insights';
import { addCheckin, app, type AppState } from '../stores/app';
import type { Level } from '../types';
import { escapeHtml, showToast } from '../ui';

let root: HTMLElement;

export function initState(container: HTMLElement) {
  root = container;
  root.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:14px;">${t('state.title')}</h2>
    <div class="card-block">
      <div style="font-weight:600;font-size:15px;margin-bottom:12px;">${t('state.checkin')}</div>
      ${slider('energy', t('state.energy'))}
      ${slider('mood', t('state.mood'))}
      ${slider('focus', t('state.focus'))}
      <input class="text-input" id="ci-note" placeholder="${t('state.note')}" style="max-width:100%;width:100%;margin:4px 0 12px;padding:11px;">
      <button class="btn btn-primary" id="ci-save" style="width:100%;">${t('state.save')}</button>
    </div>
    <div class="section-title">${t('state.trends')}</div>
    <div class="card-block" id="trends"></div>
    <div class="section-title">${t('state.insights')}</div>
    <div class="card-block" id="insights"></div>`;

  root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) =>
    r.addEventListener('input', () => {
      root.querySelector(`#val-${r.dataset.key}`)!.textContent = r.value;
    }),
  );
  root.querySelector('#ci-save')!.addEventListener('click', async () => {
    const get = (key: string) =>
      Number(root.querySelector<HTMLInputElement>(`input[data-key=${key}]`)!.value) as Level;
    const note = root.querySelector<HTMLInputElement>('#ci-note')!;
    await addCheckin(get('energy'), get('mood'), get('focus'), note.value);
    note.value = '';
    showToast(t('state.saved'));
  });

  app.subscribe(render);
  render(app.get());
}

function slider(key: string, label: string) {
  return `
    <div class="slider-row">
      <div class="slider-label"><span>${label}</span><span class="slider-value" id="val-${key}">3</span></div>
      <input type="range" min="1" max="5" value="3" data-key="${key}">
    </div>`;
}

function render(s: AppState) {
  if (!s.ready) return;
  renderTrends(s);
  renderInsights(s);
}

function renderTrends(s: AppState) {
  const el = root.querySelector('#trends')!;
  const days = 14;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const cols: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = now.getTime() - i * 86400000;
    const to = from + 86400000;
    const day = s.checkins.filter((c) => c.createdAt >= from && c.createdAt < to);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b) / xs.length : 0);
    const bar = (cls: string, v: number) =>
      `<div class="trend-bar ${cls}" style="height:${(v / 5) * 30}%"></div>`;
    cols.push(
      `<div class="trend-col">${bar('energy', avg(day.map((c) => c.energy)))}${bar('mood', avg(day.map((c) => c.mood)))}${bar('focus', avg(day.map((c) => c.focus)))}</div>`,
    );
  }
  const hasData = s.checkins.some((c) => c.createdAt >= now.getTime() - days * 86400000);
  el.innerHTML = hasData
    ? `<div class="trend-chart">${cols.join('')}</div>
       <div class="legend">
         <span><i style="background:#F59E0B"></i>${t('state.energy')}</span>
         <span><i style="background:var(--primary)"></i>${t('state.mood')}</span>
         <span><i style="background:var(--success)"></i>${t('state.focus')}</span>
       </div>`
    : `<div class="muted">${t('state.noData')}</div>`;
}

function renderInsights(s: AppState) {
  const el = root.querySelector('#insights')!;
  if (!hasEnoughData(s.thoughts, s.checkins)) {
    el.innerHTML = `<div class="muted">${t('state.noData')}</div>`;
    return;
  }
  const insights = buildInsights(s.thoughts, s.checkins);
  el.innerHTML = insights.length
    ? insights
        .map((i) => `<div class="insight-row"><span>${i.emoji}</span><span>${escapeHtml(i.text)}</span></div>`)
        .join('')
    : `<div class="muted">${t('state.noData')}</div>`;
}

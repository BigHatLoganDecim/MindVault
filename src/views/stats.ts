import { t } from '../i18n';
import { aiAvailable } from '../services/api';
import { app, toggleDone, weeklySummary, type AppState } from '../stores/app';
import type { Thought } from '../types';
import { closeSheet, escapeHtml, formatRelativeTime, openSheet, showToast } from '../ui';
import { openPlanSheet, openReleaseSheet } from './home';

let root: HTMLElement;

export function initStats(container: HTMLElement) {
  root = container;
  root.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:14px;">${t('stats.title')}</h2>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value" id="st-week">0</div><div class="stat-label">${t('stats.week')}</div></div>
      <div class="stat-card"><div class="stat-value" id="st-active">0</div><div class="stat-label">${t('stats.active')}</div></div>
      <div class="stat-card"><div class="stat-value" id="st-today">0</div><div class="stat-label">${t('stats.today')}</div></div>
      <div class="stat-card"><div class="stat-value" id="st-total">0</div><div class="stat-label">${t('stats.total')}</div></div>
    </div>
    <div class="card-block" style="margin-bottom:16px;">
      <div class="setting-row" style="border:none;padding:4px 0;">
        <div><div class="setting-label">${t('stats.review')}</div><div class="setting-desc">${t('stats.reviewDesc')}</div></div>
        <button class="btn btn-secondary" id="review-btn" style="flex:initial;padding:8px 14px;">→</button>
      </div>
    </div>
    <div class="card-block" style="margin-bottom:16px;">
      <button class="btn btn-secondary" id="summary-btn" style="width:100%;">${t('stats.weeklySummary')}</button>
      <div class="summary-box" id="summary-box"></div>
    </div>
    <div class="section-title">${t('stats.byCat')}</div>
    <div class="card-block" id="cat-breakdown"></div>
    <div class="section-title">${t('stats.capsules')}</div>
    <div class="card-block" id="capsule-list"></div>`;

  root.querySelector('#summary-btn')!.addEventListener('click', async () => {
    if (!aiAvailable()) {
      showToast(t('toast.offline'));
      return;
    }
    const box = root.querySelector('#summary-box')!;
    box.textContent = '…';
    const summary = await weeklySummary();
    box.textContent = summary ?? t('toast.offline');
  });
  root.querySelector('#review-btn')!.addEventListener('click', startReview);

  app.subscribe(render);
  render(app.get());
}

function render(s: AppState) {
  if (!s.ready) return;
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const set = (id: string, v: number) => (root.querySelector(`#${id}`)!.textContent = String(v));
  set('st-week', s.thoughts.filter((x) => x.done && (x.completedAt ?? 0) >= weekAgo).length);
  set('st-active', s.thoughts.filter((x) => !x.done && !x.closedAt).length);
  set('st-today', s.thoughts.filter((x) => x.createdAt >= startOfToday.getTime()).length);
  set('st-total', s.thoughts.length);

  // по категориям
  const breakdown = new Map<string, number>(s.settings.categories.map((c) => [c.name, 0]));
  s.thoughts
    .filter((x) => !x.done && !x.closedAt)
    .forEach((x) => breakdown.set(x.category, (breakdown.get(x.category) ?? 0) + 1));
  const max = Math.max(...breakdown.values(), 1);
  root.querySelector('#cat-breakdown')!.innerHTML = [...breakdown.entries()]
    .map(([name, n]) => {
      const c = s.settings.categories.find((x) => x.name === name);
      return `
        <div class="cat-row">
          <span style="font-size:13px;min-width:110px;">${c?.emoji ?? ''} ${escapeHtml(name)}</span>
          <div class="cat-bar"><div class="cat-bar-fill" style="width:${(n / max) * 100}%"></div></div>
          <span style="font-size:13px;font-weight:600;min-width:24px;text-align:right;">${n}</span>
        </div>`;
    })
    .join('');

  // капсулы
  const capsules = s.capsules
    .filter((c) => !c.openedAt)
    .sort((a, b) => a.openAt - b.openAt);
  root.querySelector('#capsule-list')!.innerHTML = capsules.length
    ? capsules
        .map((c) => {
          const th = s.thoughts.find((x) => x.id === c.thoughtId);
          return `<div class="cat-row"><span style="font-size:13px;">⏳ ${escapeHtml(th?.text.slice(0, 50) ?? '…')}</span><span class="muted">${new Date(c.openAt).toLocaleDateString('ru-RU')}</span></div>`;
        })
        .join('')
    : `<div class="muted">—</div>`;
}

// ---------- weekly review: разобрать зависшие мысли ----------

const STALE_DAYS = 14;

function staleThoughts(s: AppState): Thought[] {
  const cutoff = Date.now() - STALE_DAYS * 86400000;
  return s.thoughts
    .filter((x) => !x.done && !x.closedAt && x.createdAt < cutoff)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function startReview() {
  reviewStep(staleThoughts(app.get()).map((x) => x.id), 0);
}

function reviewStep(ids: string[], idx: number) {
  if (idx >= ids.length) {
    const content = openSheet(t('review.title'), `<div class="empty" style="padding:20px;"><div class="empty-icon">✨</div><div class="empty-text">${t('review.empty')}</div></div>
      <div class="sheet-actions"><button class="btn btn-primary" id="rv-done">OK</button></div>`);
    content.querySelector('#rv-done')!.addEventListener('click', closeSheet);
    return;
  }
  const th = app.get().thoughts.find((x) => x.id === ids[idx]);
  if (!th || th.done || th.closedAt) {
    reviewStep(ids, idx + 1);
    return;
  }
  const next = () => setTimeout(() => reviewStep(ids, idx + 1), 250);
  const content = openSheet(
    `${t('review.title')} (${idx + 1}/${ids.length})`,
    `
    <div class="card-block" style="margin-bottom:6px;font-size:15px;">${escapeHtml(th.text)}</div>
    <div class="muted" style="margin-bottom:12px;">${t('review.stale')} ${formatRelativeTime(th.createdAt)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <button class="btn btn-secondary" data-rv="done">${t('review.actDone')}</button>
      <button class="btn btn-secondary" data-rv="plan">${t('review.actPlan')}</button>
      <button class="btn btn-secondary" data-rv="release">${t('review.actRelease')}</button>
      <button class="btn btn-secondary" data-rv="skip">${t('review.actSkip')}</button>
    </div>`,
  );
  content.querySelectorAll<HTMLElement>('[data-rv]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      closeSheet();
      const act = btn.dataset.rv!;
      if (act === 'done') {
        await toggleDone(th.id);
        next();
      } else if (act === 'plan') {
        setTimeout(() => openPlanSheet(th.id, () => reviewStep(ids, idx + 1)), 250);
      } else if (act === 'release') {
        setTimeout(() => openReleaseSheet(th.id, () => reviewStep(ids, idx + 1)), 250);
      } else {
        next();
      }
    }),
  );
}

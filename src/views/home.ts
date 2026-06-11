import { t, pluralize } from '../i18n';
import { aiAvailable } from '../services/api';
import { categorizeByKeywords } from '../services/categorize';
import { dismissPair } from '../services/echo';
import {
  addThought,
  app,
  clearSemantic,
  createCapsule,
  decomposeThought,
  deleteThought,
  dismissOpenedCapsules,
  editThought,
  refreshEchoes,
  releaseThought,
  semanticSearch,
  toggleDone,
  toggleTask,
  undoDelete,
  type AppState,
} from '../stores/app';
import type { Thought } from '../types';
import { closeSheet, escapeHtml, formatRelativeTime, onLongPress, onSwipe, openSheet, showToast } from '../ui';

const RELEASED_FILTER = '🕊 Отпущено';

let root: HTMLElement;

export function initHome(container: HTMLElement) {
  root = container;
  root.innerHTML = `
    <div id="home-banners"></div>
    <div class="search-wrap">
      <input class="search-input" id="search" placeholder="${t('home.search')}" autocomplete="off">
      <button class="semantic-btn" id="semantic-btn" title="${t('home.semantic')}">✨</button>
    </div>
    <div class="filters" id="filters"></div>
    <div id="thoughts-list"></div>`;

  const search = root.querySelector<HTMLInputElement>('#search')!;
  search.addEventListener('input', () => {
    clearSemantic();
    app.update((s) => ({ ...s, search: search.value }));
  });
  root.querySelector('#semantic-btn')!.addEventListener('click', async () => {
    const q = app.get().search.trim();
    if (q.length < 3 || !aiAvailable()) {
      showToast(t('toast.offline'));
      return;
    }
    const btn = root.querySelector('#semantic-btn')!;
    btn.classList.add('active');
    const ok = await semanticSearch(q);
    if (!ok) {
      btn.classList.remove('active');
      showToast(t('toast.offline'));
    }
  });

  app.subscribe(render);
  render(app.get());
}

function render(s: AppState) {
  if (!s.ready) return;
  renderBanners(s);
  renderFilters(s);
  renderList(s);
  if (!s.semanticIds) root.querySelector('#semantic-btn')?.classList.remove('active');
}

// ---------- баннеры: вскрытые капсулы, эхо, напоминание ----------

function renderBanners(s: AppState) {
  const el = root.querySelector('#home-banners')!;
  el.innerHTML = '';

  for (const capsule of s.openedCapsules) {
    const thought = s.thoughts.find((x) => x.id === capsule.thoughtId);
    if (!thought) continue;
    const div = document.createElement('div');
    div.className = 'banner capsule';
    div.innerHTML = `<span>📬</span><span><b>${t('capsule.opened')}</b><br>${escapeHtml(thought.text)}</span>`;
    div.addEventListener('click', () => dismissOpenedCapsules());
    el.appendChild(div);
  }

  const echo = topEcho(s);
  if (echo) {
    const { group, thoughts } = echo;
    const div = document.createElement('div');
    div.className = 'banner echo';
    div.innerHTML = `<span>🔁</span><span><b>${t('echo.title')}:</b> ${t('echo.desc')} — ${thoughts.length} ${t('echo.times')}.<br>«${escapeHtml(thoughts[0].text.slice(0, 90))}»</span>`;
    div.addEventListener('click', () => openEchoSheet(group.id));
    el.appendChild(div);
  }

  renderReminder(s, el);
}

function topEcho(s: AppState) {
  const groups = s.echoes
    .map((group) => ({
      group,
      thoughts: group.thoughtIds
        .map((id) => s.thoughts.find((x) => x.id === id))
        .filter((x): x is Thought => !!x && !x.done && !x.closedAt),
    }))
    .filter((g) => g.thoughts.length >= 2)
    .sort((a, b) => b.thoughts.length - a.thoughts.length);
  return groups[0] ?? null;
}

function openEchoSheet(groupId: string) {
  const s = app.get();
  const group = s.echoes.find((g) => g.id === groupId);
  if (!group) return;
  const thoughts = group.thoughtIds
    .map((id) => s.thoughts.find((x) => x.id === id))
    .filter((x): x is Thought => !!x);
  const content = openSheet(
    t('echo.title'),
    `
    <div class="muted" style="margin-bottom:10px;">${t('echo.desc')} — ${thoughts.length} ${t('echo.times')}. Может, пора закрыть?</div>
    ${thoughts
      .map(
        (th, i) => `
      <div class="card-block" style="margin-bottom:8px;">
        <div style="font-size:14px;">${escapeHtml(th.text)}</div>
        <div class="muted" style="margin-top:4px;">${formatRelativeTime(th.createdAt)}</div>
        ${i > 0 ? `<button class="menu-item" data-dismiss="${th.id}" style="padding:8px 0 0;color:var(--text-secondary);font-size:13px;">${t('echo.notSame')}</button>` : ''}
      </div>`,
      )
      .join('')}
    <div class="sheet-actions"><button class="btn btn-secondary" id="echo-close">OK</button></div>`,
  );
  content.querySelector('#echo-close')!.addEventListener('click', closeSheet);
  content.querySelectorAll<HTMLElement>('[data-dismiss]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await dismissPair(group, thoughts[0].id, btn.dataset.dismiss!);
      await refreshEchoes();
      closeSheet();
    });
  });
}

function renderReminder(s: AppState, container: Element) {
  if (!s.settings.reminderEnabled) return;
  const active = s.thoughts.filter((x) => !x.done && !x.closedAt).length;
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem('mindvault_reminder_seen') === today || active === 0) return;
  const [h, m] = s.settings.reminderTime.split(':').map(Number);
  const now = new Date();
  if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return;
  const div = document.createElement('div');
  div.className = 'banner';
  div.innerHTML = `<span>🔔</span><span>${t('reminder.text')(active, pluralize(active, 'мысль', 'мысли', 'мыслей'))}</span>`;
  div.addEventListener('click', () => {
    localStorage.setItem('mindvault_reminder_seen', today);
    render(app.get());
  });
  container.appendChild(div);
}

// ---------- фильтры и список ----------

function renderFilters(s: AppState) {
  const el = root.querySelector('#filters')!;
  const chips = [
    { name: 'Все', emoji: '✨' },
    ...s.settings.categories,
    { name: RELEASED_FILTER, emoji: '' },
  ];
  el.innerHTML = chips
    .map(
      (c) =>
        `<button class="chip ${s.filter === c.name ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${c.emoji ? c.emoji + ' ' : ''}${escapeHtml(c.name)}</button>`,
    )
    .join('');
  el.querySelectorAll<HTMLElement>('.chip').forEach((b) =>
    b.addEventListener('click', () => app.update((st) => ({ ...st, filter: b.dataset.cat! }))),
  );
}

function visibleThoughts(s: AppState): Thought[] {
  let list = s.thoughts;
  if (s.filter === RELEASED_FILTER) {
    list = list.filter((x) => x.closedAt);
  } else {
    list = list.filter((x) => !x.closedAt);
    if (s.filter !== 'Все') list = list.filter((x) => x.category === s.filter);
  }
  if (s.semanticIds) {
    return list
      .filter((x) => s.semanticIds!.has(x.id))
      .sort((a, b) => s.semanticIds!.get(b.id)! - s.semanticIds!.get(a.id)!);
  }
  const q = s.search.trim().toLowerCase();
  if (q) list = list.filter((x) => x.text.toLowerCase().includes(q));
  return list;
}

function renderList(s: AppState) {
  const el = root.querySelector('#thoughts-list')!;
  const list = visibleThoughts(s);
  if (!list.length) {
    const isEmpty = s.thoughts.length === 0;
    el.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${isEmpty ? '🧠' : '🔍'}</div>
        <div class="empty-title">${isEmpty ? t('home.empty.title') : t('home.notfound.title')}</div>
        <div class="empty-text">${isEmpty ? t('home.empty.text') : t('home.notfound.text')}</div>
      </div>`;
    return;
  }
  el.innerHTML = '';
  for (const th of list) el.appendChild(thoughtCard(s, th));
}

function thoughtCard(s: AppState, th: Thought): HTMLElement {
  const cat = s.settings.categories.find((c) => c.name === th.category);
  const tasks = s.tasks.filter((x) => x.thoughtId === th.id).sort((a, b) => a.order - b.order);
  const echoGroup = s.echoes.find((g) => g.thoughtIds.includes(th.id));
  const div = document.createElement('div');
  div.className = `thought-card ${th.done ? 'done' : ''} ${th.closedAt ? 'released' : ''}`;
  div.innerHTML = `
    <div class="check-circle ${th.done ? 'checked' : ''}">${th.done ? '✓' : ''}</div>
    <div class="thought-body">
      <div class="thought-text">${escapeHtml(th.text)}</div>
      <div class="thought-meta">
        <span class="cat-badge">${cat?.emoji ?? '📌'} ${escapeHtml(th.category)}</span>
        <span>${formatRelativeTime(th.createdAt)}</span>
        ${echoGroup && !th.closedAt ? `<span class="echo-badge">🔁 эхо</span>` : ''}
        ${th.closedAt ? `<span>🕊${th.closeReason ? ' ' + escapeHtml(th.closeReason) : ''}</span>` : ''}
      </div>
      ${
        tasks.length
          ? `<div class="task-list">${tasks
              .map(
                (task) =>
                  `<div class="task-row ${task.done ? 'done' : ''}" data-task="${task.id}"><span class="task-check">${task.done ? '✓' : ''}</span><span>${escapeHtml(task.text)}</span></div>`,
              )
              .join('')}</div>`
          : ''
      }
    </div>`;

  div.querySelectorAll<HTMLElement>('[data-task]').forEach((row) =>
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      void toggleTask(row.dataset.task!);
    }),
  );
  div.addEventListener('click', () => void toggleDone(th.id));
  onLongPress(div, () => openThoughtMenu(th.id));
  onSwipe(
    div,
    () => deleteWithUndo(th.id),
    () => void toggleDone(th.id),
  );
  return div;
}

function deleteWithUndo(id: string) {
  void deleteThought(id).then(() =>
    showToast(t('toast.deleted'), { label: t('toast.undo'), onClick: () => void undoDelete() }),
  );
}

// ---------- меню мысли (долгое нажатие) ----------

function openThoughtMenu(id: string) {
  const content = openSheet(
    '',
    `
    <button class="menu-item" data-act="edit">${t('menu.edit')}</button>
    <button class="menu-item" data-act="plan">${t('menu.plan')}</button>
    <button class="menu-item" data-act="capsule">${t('menu.capsule')}</button>
    <button class="menu-item" data-act="release">${t('menu.release')}</button>
    <button class="menu-item danger" data-act="delete">${t('menu.delete')}</button>`,
  );
  content.querySelectorAll<HTMLElement>('[data-act]').forEach((btn) =>
    btn.addEventListener('click', () => {
      closeSheet();
      const act = btn.dataset.act!;
      if (act === 'edit') setTimeout(() => openEditSheet(id), 250);
      if (act === 'plan') setTimeout(() => openPlanSheet(id), 250);
      if (act === 'capsule') setTimeout(() => openCapsuleSheet(id), 250);
      if (act === 'release') setTimeout(() => openReleaseSheet(id), 250);
      if (act === 'delete') deleteWithUndo(id);
    }),
  );
}

export function openAddSheet() {
  openThoughtEditor(null);
}

function openEditSheet(id: string) {
  openThoughtEditor(id);
}

function openThoughtEditor(id: string | null) {
  const existing = id ? app.get().thoughts.find((x) => x.id === id) : null;
  const content = openSheet(
    id ? t('sheet.edit') : t('sheet.new'),
    `
    <textarea class="thought-textarea" id="th-input" placeholder="${t('sheet.placeholder')}">${existing ? escapeHtml(existing.text) : ''}</textarea>
    <button class="voice-btn" id="voice-btn">${t('sheet.voice')}</button>
    <div class="category-hint" id="cat-hint">${t('sheet.catAuto')}</div>
    <div class="sheet-actions">
      <button class="btn btn-secondary" id="th-cancel">${t('sheet.cancel')}</button>
      <button class="btn btn-primary" id="th-save" ${existing ? '' : 'disabled'}>${t('sheet.save')}</button>
    </div>`,
  );
  const input = content.querySelector<HTMLTextAreaElement>('#th-input')!;
  const saveBtn = content.querySelector<HTMLButtonElement>('#th-save')!;
  const hint = content.querySelector('#cat-hint')!;
  setTimeout(() => input.focus(), 300);

  input.addEventListener('input', () => {
    const text = input.value.trim();
    saveBtn.disabled = text.length < 2;
    if (text.length > 3) {
      const cats = app.get().settings.categories;
      const cat = categorizeByKeywords(
        text,
        cats.map((c) => c.name),
      );
      const emoji = cats.find((c) => c.name === cat)?.emoji ?? '📌';
      hint.textContent = `→ ${emoji} ${cat}${aiAvailable() ? ' (ИИ уточнит после сохранения)' : ''}`;
    } else {
      hint.textContent = t('sheet.catAuto');
    }
  });
  content.querySelector('#th-cancel')!.addEventListener('click', closeSheet);
  saveBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (text.length < 2) return;
    closeSheet();
    if (id) await editThought(id, text);
    else await addThought(text, voiceUsed ? 'voice' : 'text');
    showToast(t('toast.saved'));
  });
  bindVoice(content.querySelector('#voice-btn')!, input);
}

// ---------- голосовой ввод ----------
let voiceUsed = false;

function bindVoice(btn: HTMLElement, input: HTMLTextAreaElement) {
  voiceUsed = false;
  const w = window as unknown as Record<string, unknown>;
  const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
  if (!SR) {
    (btn as HTMLElement).style.display = 'none';
    return;
  }
  const rec = new SR();
  rec.lang = 'ru-RU';
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    input.value = (input.value ? input.value + ' ' : '') + text;
    input.dispatchEvent(new Event('input'));
    voiceUsed = true;
  };
  rec.onend = () => {
    btn.classList.remove('recording');
    btn.textContent = t('sheet.voice');
  };
  rec.onerror = () => {
    btn.classList.remove('recording');
    btn.textContent = t('sheet.voice');
    showToast(t('toast.voiceError'));
  };
  btn.addEventListener('click', () => {
    if (btn.classList.contains('recording')) {
      rec.stop();
    } else {
      try {
        rec.start();
        btn.classList.add('recording');
        btn.textContent = t('sheet.voiceStop');
      } catch {
        showToast(t('toast.voiceError'));
      }
    }
  });
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void;
  onend: () => void;
  onerror: () => void;
  start(): void;
  stop(): void;
}

// ---------- капсула времени ----------

function openCapsuleSheet(id: string) {
  const inMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const content = openSheet(
    t('capsule.title'),
    `
    <div class="muted" style="margin-bottom:10px;">${t('capsule.when')}</div>
    <input type="date" class="text-input" id="cap-date" value="${inMonth}" style="max-width:100%;width:100%;padding:12px;">
    <div class="sheet-actions">
      <button class="btn btn-secondary" id="cap-cancel">${t('sheet.cancel')}</button>
      <button class="btn btn-primary" id="cap-save">${t('sheet.save')}</button>
    </div>`,
  );
  content.querySelector('#cap-cancel')!.addEventListener('click', closeSheet);
  content.querySelector('#cap-save')!.addEventListener('click', async () => {
    const date = content.querySelector<HTMLInputElement>('#cap-date')!.value;
    if (!date) return;
    const openAt = new Date(date + 'T09:00:00').getTime();
    closeSheet();
    await createCapsule(id, openAt);
    showToast(t('capsule.created'));
  });
}

// ---------- анти-список (ритуал отпускания) ----------

export function openReleaseSheet(id: string, onDone?: () => void) {
  const th = app.get().thoughts.find((x) => x.id === id);
  if (!th) return;
  const content = openSheet(
    t('release.title'),
    `
    <div class="card-block" style="margin-bottom:12px;font-size:14px;">${escapeHtml(th.text)}</div>
    <div class="muted" style="margin-bottom:8px;">${t('release.why')}</div>
    <textarea class="thought-textarea" id="rel-reason" style="min-height:60px;"></textarea>
    <div class="sheet-actions">
      <button class="btn btn-secondary" id="rel-cancel">${t('sheet.cancel')}</button>
      <button class="btn btn-primary" id="rel-ok">🕊 ${t('release.confirm')}</button>
    </div>`,
  );
  content.querySelector('#rel-cancel')!.addEventListener('click', closeSheet);
  content.querySelector('#rel-ok')!.addEventListener('click', async () => {
    const reason = content.querySelector<HTMLTextAreaElement>('#rel-reason')!.value;
    closeSheet();
    await releaseThought(id, reason);
    showToast(t('release.done'));
    onDone?.();
  });
}

// ---------- план из мысли ----------

export function openPlanSheet(id: string, onDone?: () => void) {
  if (!aiAvailable()) {
    showToast(t('toast.offline'));
    return;
  }
  const content = openSheet(t('plan.title'), `<div class="muted">${t('plan.loading')}</div>`);
  void decomposeThought(id).then((tasks) => {
    if (!tasks) {
      content.innerHTML = `<div class="muted">${t('chat.offline')}</div>`;
      return;
    }
    content.innerHTML = `
      ${tasks.map((task) => `<div class="task-row"><span class="task-check"></span><span>${escapeHtml(task.text)}</span></div>`).join('')}
      <div class="sheet-actions"><button class="btn btn-primary" id="plan-ok">OK</button></div>`;
    content.querySelector('#plan-ok')!.addEventListener('click', () => {
      closeSheet();
      onDone?.();
    });
  });
}

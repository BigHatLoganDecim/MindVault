import { pluralize, t } from './i18n';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minAgo')(min);
  const h = Math.floor(min / 60);
  if (h < 24) return t('time.hAgo')(h);
  const d = Math.floor(h / 24);
  if (d < 7) return t('time.dAgo')(d, pluralize(d, 'день', 'дня', 'дней'));
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// ---- toast (с опциональным действием — undo) ----
let toastTimer: ReturnType<typeof setTimeout>;

export function showToast(msg: string, action?: { label: string; onClick: () => void }) {
  const el = document.getElementById('toast')!;
  el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.onClick();
      el.classList.remove('show');
    });
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
}

// ---- bottom sheet ----
export function openSheet(title: string, contentHtml: string): HTMLElement {
  const backdrop = document.getElementById('backdrop')!;
  const sheet = document.getElementById('sheet')!;
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    ${title ? `<div class="sheet-title">${escapeHtml(title)}</div>` : ''}
    <div class="sheet-content">${contentHtml}</div>`;
  backdrop.classList.add('open');
  sheet.classList.add('open');
  return sheet.querySelector('.sheet-content')!;
}

export function closeSheet() {
  document.getElementById('backdrop')!.classList.remove('open');
  document.getElementById('sheet')!.classList.remove('open');
}

// ---- long press ----
export function onLongPress(el: HTMLElement, fn: () => void, ms = 500) {
  let timer: ReturnType<typeof setTimeout>;
  const start = () => {
    timer = setTimeout(fn, ms);
  };
  const cancel = () => clearTimeout(timer);
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchmove', cancel);
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
}

/** Горизонтальный свайп по карточке: влево/вправо. */
export function onSwipe(el: HTMLElement, onLeft: () => void, onRight: () => void) {
  let startX = 0,
    startY = 0,
    active = false;
  el.addEventListener(
    'touchstart',
    (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      active = true;
    },
    { passive: true },
  );
  el.addEventListener(
    'touchend',
    (e) => {
      if (!active) return;
      active = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) onLeft();
      else onRight();
    },
    { passive: true },
  );
}

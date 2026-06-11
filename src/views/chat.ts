import { t } from '../i18n';
import { aiAvailable } from '../services/api';
import { app, sendChatMessage, type AppState } from '../stores/app';
import { escapeHtml } from '../ui';

let root: HTMLElement;

export function initChat(container: HTMLElement) {
  root = container;
  root.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-messages" id="chat-messages"></div>
    </div>
    <div class="chat-input-row" id="chat-input-row" style="display:none;">
      <input class="chat-input" id="chat-input" placeholder="${t('chat.placeholder')}" autocomplete="off">
      <button class="chat-send" id="chat-send">➤</button>
    </div>`;

  const input = root.querySelector<HTMLInputElement>('#chat-input')!;
  const send = root.querySelector<HTMLButtonElement>('#chat-send')!;
  const submit = () => {
    const text = input.value.trim();
    if (!text || app.get().chatBusy) return;
    input.value = '';
    void sendChatMessage(text);
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  app.subscribe(render);
  render(app.get());
}

function render(s: AppState) {
  if (!s.ready) return;
  // строка ввода видна только на вкладке чата
  root.querySelector<HTMLElement>('#chat-input-row')!.style.display =
    s.view === 'chat' ? 'flex' : 'none';
  root.querySelector<HTMLButtonElement>('#chat-send')!.disabled = s.chatBusy;

  const el = root.querySelector('#chat-messages')!;
  if (!s.chat.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🤝</div><div class="empty-text">${
      aiAvailable() ? t('chat.empty') : t('chat.offline')
    }</div></div>`;
    return;
  }
  el.innerHTML =
    s.chat
      .map((m) => `<div class="chat-msg ${m.role}">${escapeHtml(m.content)}</div>`)
      .join('') + (s.chatBusy ? `<div class="chat-msg assistant busy">…</div>` : '');
  if (s.view === 'chat') {
    const container = root.closest('.view-container');
    if (container) container.scrollTop = container.scrollHeight;
  }
}

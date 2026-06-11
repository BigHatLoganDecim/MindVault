/**
 * Summary профиля пользователя (план §2.3): компактный портрет до ~500
 * токенов. Пересобирается раз в сутки при первом открытии приложения из
 * мыслей и чек-инов за последние 30 дней; хранится только локально.
 */
import type { StateCheckin, Thought } from '../types';
import { aiAvailable, apiSummarize } from './api';
import { getProfileSummary, saveProfileSummary } from './db';

const DAY = 86400000;

export async function refreshProfileSummaryIfStale(
  thoughts: Thought[],
  checkins: StateCheckin[],
): Promise<void> {
  if (!aiAvailable()) return;
  const current = await getProfileSummary();
  if (current && Date.now() - current.builtAt < DAY) return;

  const since = Date.now() - 30 * DAY;
  const recentThoughts = thoughts
    .filter((t) => t.createdAt >= since)
    .slice(0, 100)
    .map((t) => `[${t.category}${t.done ? ', закрыто' : ''}] ${t.text}`);
  if (recentThoughts.length < 5) return;
  const recentCheckins = checkins
    .filter((c) => c.createdAt >= since)
    .map(
      (c) =>
        `${new Date(c.createdAt).toLocaleDateString('ru-RU')}: энергия ${c.energy}/5, настроение ${c.mood}/5, фокус ${c.focus}/5${c.note ? ` — ${c.note}` : ''}`,
    );

  const summary = await apiSummarize('profile', recentThoughts, recentCheckins);
  if (summary) await saveProfileSummary({ text: summary, builtAt: Date.now() });
}

/** Сборка RAG-контекста для чата: top-k мыслей + summary профиля. */
export function buildChatContext(
  relevant: { thought: Thought; score: number }[],
  profile: string | null,
): string | null {
  const parts: string[] = [];
  if (profile) parts.push(`Портрет пользователя:\n${profile}`);
  if (relevant.length) {
    const lines = relevant.map(
      ({ thought }) =>
        `- (${new Date(thought.createdAt).toLocaleDateString('ru-RU')}, ${thought.category}${thought.done ? ', закрыто' : thought.closedAt ? ', отпущено' : ''}) ${thought.text}`,
    );
    parts.push(`Релевантные мысли пользователя:\n${lines.join('\n')}`);
  }
  return parts.length ? parts.join('\n\n') : null;
}

import type { StateCheckin, Thought } from '../types';

export interface Insight {
  emoji: string;
  text: string;
}

const MIN_CHECKINS = 10;
const MIN_THOUGHTS = 20;

const SLOTS: [string, (h: number) => boolean][] = [
  ['утром', (h) => h >= 5 && h < 12],
  ['днём', (h) => h >= 12 && h < 18],
  ['вечером', (h) => h >= 18 && h < 24],
  ['ночью', (h) => h < 5],
];

function slotOf(ts: number): string {
  const h = new Date(ts).getHours();
  return SLOTS.find(([, fn]) => fn(h))![0];
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Наблюдения из чек-инов и мыслей. Показываются только при достаточном
 * объёме данных — никаких выводов из трёх точек (план §3, Этап 3).
 */
export function buildInsights(thoughts: Thought[], checkins: StateCheckin[]): Insight[] {
  const insights: Insight[] = [];

  if (thoughts.length >= MIN_THOUGHTS) {
    // В какое время суток чаще всего закрываются мысли
    const doneSlots = thoughts.filter((t) => t.completedAt).map((t) => slotOf(t.completedAt!));
    if (doneSlots.length >= 8) {
      const counts = new Map<string, number>();
      doneSlots.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
      const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n / doneSlots.length >= 0.4) {
        insights.push({ emoji: '🌅', text: `Ты чаще всего закрываешь дела ${best}.` });
      }
    }

    // Тональность (если включена и проанализирована)
    const toned = thoughts.filter((t) => t.tone);
    if (toned.length >= 15) {
      const anxious = toned.filter((t) => t.tone === 'anxious').length / toned.length;
      if (anxious >= 0.35) {
        insights.push({
          emoji: '🫂',
          text: `Заметная часть записей звучит тревожно (${Math.round(anxious * 100)}%). Это мягкий сигнал, не диагноз — но, может, стоит к себе прислушаться.`,
        });
      }
    }

    // Паттерн откладывания: старые активные мысли
    const now = Date.now();
    const stale = thoughts.filter(
      (t) => !t.done && !t.closedAt && now - t.createdAt > 21 * 86400000,
    );
    if (stale.length >= 3) {
      insights.push({
        emoji: '🧹',
        text: `${stale.length} мыслей висят больше трёх недель. Weekly review поможет решить их судьбу.`,
      });
    }
  }

  if (checkins.length >= MIN_CHECKINS) {
    // Энергия по времени суток
    const bySlot = new Map<string, number[]>();
    checkins.forEach((c) =>
      bySlot.set(slotOf(c.createdAt), [...(bySlot.get(slotOf(c.createdAt)) ?? []), c.energy]),
    );
    const slots = [...bySlot.entries()].filter(([, xs]) => xs.length >= 3);
    if (slots.length >= 2) {
      const sorted = slots.sort((a, b) => avg(b[1]) - avg(a[1]));
      const [bestSlot] = sorted[0];
      const [worstSlot] = sorted[sorted.length - 1];
      if (avg(sorted[0][1]) - avg(sorted[sorted.length - 1][1]) >= 0.8) {
        insights.push({
          emoji: '⚡',
          text: `Энергия выше всего ${bestSlot}, ниже всего — ${worstSlot}. Сложное лучше планировать на пик.`,
        });
      }
    }

    // Динамика настроения: последняя неделя vs предыдущая
    const now = Date.now();
    const wk = (from: number, to: number) =>
      checkins.filter((c) => c.createdAt >= from && c.createdAt < to).map((c) => c.mood);
    const last = wk(now - 7 * 86400000, now);
    const prev = wk(now - 14 * 86400000, now - 7 * 86400000);
    if (last.length >= 3 && prev.length >= 3) {
      const diff = avg(last) - avg(prev);
      if (diff >= 0.7) insights.push({ emoji: '📈', text: 'Настроение за неделю заметно выросло.' });
      if (diff <= -0.7)
        insights.push({ emoji: '📉', text: 'Настроение за неделю просело. Береги себя.' });
    }
  }

  return insights;
}

export function hasEnoughData(thoughts: Thought[], checkins: StateCheckin[]): boolean {
  return thoughts.length >= MIN_THOUGHTS || checkins.length >= MIN_CHECKINS;
}

import { describe, expect, it } from 'vitest';
import { categorizeByKeywords } from '../src/services/categorize';
import { buildInsights, hasEnoughData } from '../src/services/insights';
import { cosineSimilarity, similarPairs, topKSimilar } from '../src/services/search';
import type { StateCheckin, Thought } from '../src/types';

function thought(p: Partial<Thought>): Thought {
  return {
    id: Math.random().toString(36).slice(2),
    text: 'x',
    category: 'Когда-нибудь',
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    done: false,
    completedAt: null,
    closedAt: null,
    closeReason: null,
    embedding: null,
    tone: null,
    echoGroupId: null,
    linkedTaskIds: [],
    source: 'text',
    ...p,
  };
}

describe('cosineSimilarity', () => {
  it('1 для коллинеарных, 0 для ортогональных', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1);
  });
  it('нулевой вектор не делит на ноль', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('topKSimilar', () => {
  it('сортирует по близости и режет по k и minScore', () => {
    const a = thought({ embedding: [1, 0, 0] });
    const b = thought({ embedding: [0.9, 0.1, 0] });
    const far = thought({ embedding: [0, 0, 1] });
    const none = thought({ embedding: null });
    const res = topKSimilar([1, 0, 0], [far, none, b, a], 2);
    expect(res.map((r) => r.thought.id)).toEqual([a.id, b.id]);
  });
});

describe('similarPairs (Эхо)', () => {
  it('находит пары выше порога только среди активных', () => {
    const a = thought({ embedding: [1, 0] });
    const b = thought({ embedding: [0.95, 0.05] });
    const doneOne = thought({ embedding: [1, 0], done: true });
    const released = thought({ embedding: [1, 0], closedAt: Date.now() });
    const pairs = similarPairs([a, b, doneOne, released], 0.9);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].score).toBeGreaterThan(0.9);
  });
});

describe('categorizeByKeywords (офлайн-fallback)', () => {
  const cats = ['Покупки', 'Здоровье', 'Работа / Деньги', 'Развитие', 'Семья', 'Когда-нибудь'];
  it('находит категорию по ключевому слову', () => {
    expect(categorizeByKeywords('надо купить молоко', cats)).toBe('Покупки');
    expect(categorizeByKeywords('записаться к врачу', cats)).toBe('Здоровье');
  });
  it('без совпадений падает в последнюю категорию', () => {
    expect(categorizeByKeywords('абракадабра', cats)).toBe('Когда-нибудь');
  });
});

describe('insights: никаких выводов из трёх точек', () => {
  it('молчит при недостатке данных', () => {
    const checkins: StateCheckin[] = [
      { id: '1', createdAt: Date.now(), energy: 5, mood: 5, focus: 5, note: null },
    ];
    expect(hasEnoughData([], checkins)).toBe(false);
    expect(buildInsights([], checkins)).toEqual([]);
  });
  it('замечает зависшие мысли при достаточном объёме', () => {
    const old = Date.now() - 30 * 86400000;
    const thoughts = Array.from({ length: 20 }, (_, i) =>
      thought({ createdAt: i < 5 ? old : Date.now() }),
    );
    const insights = buildInsights(thoughts, []);
    expect(insights.some((i) => i.text.includes('Weekly review'))).toBe(true);
  });
});

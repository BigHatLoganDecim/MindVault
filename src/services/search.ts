import type { Thought } from '../types';

/**
 * Косинусная близость. Для тысяч мыслей линейный проход занимает
 * миллисекунды — векторная БД не нужна (осознанное решение, см. план §2.3).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface ScoredThought {
  thought: Thought;
  score: number;
}

/** top-k мыслей по близости к вектору запроса (только локальные данные). */
export function topKSimilar(
  query: number[],
  thoughts: Thought[],
  k: number,
  minScore = 0.3,
): ScoredThought[] {
  return thoughts
    .filter((t) => t.embedding)
    .map((t) => ({ thought: t, score: cosineSimilarity(query, t.embedding!) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Пары похожих мыслей для «Эха» (среди активных). */
export function similarPairs(
  thoughts: Thought[],
  threshold: number,
): { a: Thought; b: Thought; score: number }[] {
  const active = thoughts.filter((t) => !t.done && !t.closedAt && t.embedding);
  const pairs: { a: Thought; b: Thought; score: number }[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const score = cosineSimilarity(active[i].embedding!, active[j].embedding!);
      if (score >= threshold) pairs.push({ a: active[i], b: active[j], score });
    }
  }
  return pairs;
}

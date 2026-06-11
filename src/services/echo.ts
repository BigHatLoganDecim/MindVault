import type { EchoGroup, Thought } from '../types';
import { allEchoes, put, uid } from './db';
import { similarPairs } from './search';

/**
 * «Эхо мыслей»: группирует активные мысли, похожие выше порога, в EchoGroup.
 * Пары, помеченные пользователем как ложные срабатывания (dismissedIds в
 * формате "idA|idB", отсортированно), исключаются навсегда.
 */
export async function rebuildEchoes(thoughts: Thought[], threshold: number): Promise<EchoGroup[]> {
  const existing = await allEchoes();
  const dismissed = new Set(existing.flatMap((g) => g.dismissedIds));

  const pairs = similarPairs(thoughts, threshold).filter(
    (p) => !dismissed.has(pairKey(p.a.id, p.b.id)),
  );

  // union-find по парам → связные группы
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const p of pairs) {
    if (!parent.has(p.a.id)) parent.set(p.a.id, p.a.id);
    if (!parent.has(p.b.id)) parent.set(p.b.id, p.b.id);
    parent.set(find(p.a.id), find(p.b.id));
  }
  const groupsByRoot = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    groupsByRoot.set(root, [...(groupsByRoot.get(root) ?? []), id]);
  }

  const groups: EchoGroup[] = [];
  for (const ids of groupsByRoot.values()) {
    if (ids.length < 2) continue;
    const prev = existing.find((g) => g.thoughtIds.some((id) => ids.includes(id)));
    const group: EchoGroup = {
      id: prev?.id ?? uid(),
      thoughtIds: ids,
      dismissedIds: prev?.dismissedIds ?? [],
      updatedAt: Date.now(),
    };
    await put('echoes', group);
    groups.push(group);
  }
  return groups;
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** Пользователь сказал «это не то же самое» — пара исключается из эха. */
export async function dismissPair(group: EchoGroup, idA: string, idB: string): Promise<void> {
  group.dismissedIds.push(pairKey(idA, idB));
  group.thoughtIds = group.thoughtIds.filter((id) => id !== idB);
  group.updatedAt = Date.now();
  await put('echoes', group);
}

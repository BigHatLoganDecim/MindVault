import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetDbForTests } from '../src/services/db';
import { dismissPair, pairKey, rebuildEchoes } from '../src/services/echo';
import type { Thought } from '../src/types';

function thought(id: string, embedding: number[]): Thought {
  return {
    id,
    text: id,
    category: 'Когда-нибудь',
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    done: false,
    completedAt: null,
    closedAt: null,
    closeReason: null,
    embedding,
    tone: null,
    echoGroupId: null,
    linkedTaskIds: [],
    source: 'text',
  };
}

describe('Эхо мыслей', () => {
  beforeEach(() => _resetDbForTests());

  it('группирует похожие мысли (транзитивно)', async () => {
    const a = thought('a', [1, 0, 0]);
    const b = thought('b', [0.99, 0.01, 0]);
    const c = thought('c', [0.98, 0.02, 0]);
    const far = thought('far', [0, 1, 0]);
    const groups = await rebuildEchoes([a, b, c, far], 0.9);
    expect(groups).toHaveLength(1);
    expect(groups[0].thoughtIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('dismissPair исключает пару навсегда (ложное срабатывание)', async () => {
    const a = thought('a', [1, 0]);
    const b = thought('b', [0.99, 0.01]);
    let groups = await rebuildEchoes([a, b], 0.9);
    expect(groups).toHaveLength(1);

    await dismissPair(groups[0], 'a', 'b');
    groups = await rebuildEchoes([a, b], 0.9);
    expect(groups).toHaveLength(0);
  });

  it('pairKey не зависит от порядка', () => {
    expect(pairKey('x', 'y')).toBe(pairKey('y', 'x'));
  });
});

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetDbForTests,
  allThoughts,
  exportAll,
  getSettings,
  importAll,
  legacyThoughtToThought,
  migrateFromLocalStorage,
  put,
} from '../src/services/db';
import type { LegacyThought } from '../src/types';

function fakeStorage(init: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const legacy: LegacyThought[] = [
  { id: 1700000000001, text: 'купить молоко', category: 'Покупки', created: 1700000000001, done: false, completedAt: null },
  { id: 1700000000002, text: 'позвонить маме', category: 'Семья', created: 1700000000002, done: true, completedAt: 1700000100000 },
];

describe('миграция из v0.1', () => {
  beforeEach(() => _resetDbForTests());

  it('переносит все мысли без потерь и маппит поля', async () => {
    const storage = fakeStorage({
      mindvault_thoughts_v1: JSON.stringify(legacy),
      mindvault_settings_v1: JSON.stringify({ reminderEnabled: true, reminderTime: '21:30' }),
    });
    const migrated = await migrateFromLocalStorage(storage);
    expect(migrated).toBe(2);

    const thoughts = await allThoughts();
    expect(thoughts).toHaveLength(2);
    const milk = thoughts.find((t) => t.text === 'купить молоко')!;
    expect(milk.id).toBe('1700000000001');
    expect(milk.done).toBe(false);
    expect(milk.source).toBe('migrated');
    expect(milk.embedding).toBeNull();
    expect(milk.linkedTaskIds).toEqual([]);
    const mom = thoughts.find((t) => t.text === 'позвонить маме')!;
    expect(mom.done).toBe(true);
    expect(mom.completedAt).toBe(1700000100000);

    const settings = await getSettings();
    expect(settings.reminderEnabled).toBe(true);
    expect(settings.reminderTime).toBe('21:30');

    // localStorage очищен — миграция не повторится
    expect(storage.getItem('mindvault_thoughts_v1')).toBeNull();
    expect(await migrateFromLocalStorage(storage)).toBe(0);
  });

  it('идемпотентна: повторный запуск не дублирует мысли', async () => {
    const storage = fakeStorage({ mindvault_thoughts_v1: JSON.stringify(legacy) });
    await migrateFromLocalStorage(storage);
    // имитируем «localStorage не очистился» (например, сбой между шагами)
    storage.setItem('mindvault_thoughts_v1', JSON.stringify(legacy));
    await migrateFromLocalStorage(storage);
    expect(await allThoughts()).toHaveLength(2);
  });

  it('битый JSON сохраняется в backup и не валит приложение', async () => {
    const storage = fakeStorage({ mindvault_thoughts_v1: '{оборванный json' });
    const migrated = await migrateFromLocalStorage(storage);
    expect(migrated).toBe(0);
    expect(await allThoughts()).toHaveLength(0);
    expect(storage.getItem('mindvault_thoughts_v1')).toBeNull();
  });

  it('legacyThoughtToThought заполняет новые поля значениями по умолчанию', () => {
    const t = legacyThoughtToThought(legacy[0]);
    expect(t).toMatchObject({
      closedAt: null,
      closeReason: null,
      tone: null,
      echoGroupId: null,
      tags: [],
    });
  });
});

describe('экспорт/импорт', () => {
  beforeEach(() => _resetDbForTests());

  it('round-trip сохраняет данные', async () => {
    await put('thoughts', legacyThoughtToThought(legacy[0]));
    const dump = await exportAll();
    expect(dump.thoughts).toHaveLength(1);

    await _resetDbForTests();
    const count = await importAll(dump);
    expect(count).toBe(1);
    expect((await allThoughts())[0].text).toBe('купить молоко');
  });
});

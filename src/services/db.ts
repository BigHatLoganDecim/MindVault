import type {
  ChatMessage,
  EchoGroup,
  LegacyThought,
  ProfileSummary,
  Settings,
  StateCheckin,
  Task,
  Thought,
  TimeCapsule,
} from '../types';

const DB_NAME = 'mindvault';
export const DB_VERSION = 1;

const LEGACY_THOUGHTS_KEY = 'mindvault_thoughts_v1';
const LEGACY_SETTINGS_KEY = 'mindvault_settings_v1';

export const DEFAULT_CATEGORIES = [
  { name: 'Покупки', emoji: '🛒', custom: false },
  { name: 'Здоровье', emoji: '💪', custom: false },
  { name: 'Работа / Деньги', emoji: '💼', custom: false },
  { name: 'Развитие', emoji: '📚', custom: false },
  { name: 'Семья', emoji: '❤️', custom: false },
  { name: 'Когда-нибудь', emoji: '🌙', custom: false },
];

export const DEFAULT_SETTINGS: Settings = {
  reminderEnabled: false,
  reminderTime: '20:00',
  theme: 'auto',
  apiUrl: '',
  aiEnabled: true,
  toneAnalysisEnabled: false,
  echoThreshold: 0.86,
  categories: DEFAULT_CATEGORIES,
};

type StoreName =
  | 'thoughts'
  | 'checkins'
  | 'tasks'
  | 'capsules'
  | 'echoes'
  | 'chat'
  | 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // Версия 1: первичная схема. Следующие версии добавляют ветки по
      // e.oldVersion, ничего не удаляя.
      if (e.oldVersion < 1) {
        const thoughts = db.createObjectStore('thoughts', { keyPath: 'id' });
        thoughts.createIndex('createdAt', 'createdAt');
        thoughts.createIndex('category', 'category');
        const checkins = db.createObjectStore('checkins', { keyPath: 'id' });
        checkins.createIndex('createdAt', 'createdAt');
        const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
        tasks.createIndex('thoughtId', 'thoughtId');
        const capsules = db.createObjectStore('capsules', { keyPath: 'id' });
        capsules.createIndex('openAt', 'openAt');
        db.createObjectStore('echoes', { keyPath: 'id' });
        const chat = db.createObjectStore('chat', { keyPath: 'id' });
        chat.createIndex('createdAt', 'createdAt');
        db.createObjectStore('meta'); // key-value: settings, profileSummary, backups
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ---- generic CRUD ----
export const getAll = <T>(store: StoreName) =>
  tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
export const put = <T>(store: StoreName, value: T) =>
  tx(store, 'readwrite', (s) => s.put(value)).then(() => value);
export const remove = (store: StoreName, id: string) =>
  tx(store, 'readwrite', (s) => s.delete(id));
export const clearStore = (store: StoreName) => tx(store, 'readwrite', (s) => s.clear());

export const allThoughts = () => getAll<Thought>('thoughts');
export const allCheckins = () => getAll<StateCheckin>('checkins');
export const allTasks = () => getAll<Task>('tasks');
export const allCapsules = () => getAll<TimeCapsule>('capsules');
export const allEchoes = () => getAll<EchoGroup>('echoes');
export const allChat = () => getAll<ChatMessage>('chat');

// ---- meta (key-value) ----
export function metaGet<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>('meta', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}
export function metaSet<T>(key: string, value: T): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction('meta', 'readwrite');
        t.objectStore('meta').put(value, key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

export const getSettings = async (): Promise<Settings> => ({
  ...DEFAULT_SETTINGS,
  ...((await metaGet<Partial<Settings>>('settings')) ?? {}),
});
export const saveSettings = (s: Settings) => metaSet('settings', s);
export const getProfileSummary = () => metaGet<ProfileSummary>('profileSummary');
export const saveProfileSummary = (p: ProfileSummary) => metaSet('profileSummary', p);

export function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// ---- миграция из v0.1 (localStorage) ----

export function legacyThoughtToThought(old: LegacyThought): Thought {
  return {
    id: String(old.id),
    text: old.text,
    category: old.category,
    tags: [],
    createdAt: old.created,
    updatedAt: old.created,
    done: old.done,
    completedAt: old.completedAt ?? null,
    closedAt: null,
    closeReason: null,
    embedding: null,
    tone: null,
    echoGroupId: null,
    linkedTaskIds: [],
    source: 'migrated',
  };
}

/**
 * Переносит данные прототипа v0.1 из localStorage в IndexedDB.
 * Перед миграцией кладёт полный backup исходных данных в meta —
 * ни одна мысль пользователя не теряется даже при сбое маппинга.
 * Идемпотентна: после успешного переноса localStorage-ключи удаляются.
 */
export async function migrateFromLocalStorage(storage: Storage): Promise<number> {
  const raw = storage.getItem(LEGACY_THOUGHTS_KEY);
  if (!raw) return 0;

  let legacy: LegacyThought[];
  try {
    legacy = JSON.parse(raw);
  } catch {
    // Битый JSON — сохраняем как есть в backup и не трогаем дальше.
    await metaSet(`backup_v01_corrupt_${Date.now()}`, raw);
    storage.removeItem(LEGACY_THOUGHTS_KEY);
    return 0;
  }

  await metaSet(`backup_v01_${Date.now()}`, {
    thoughts: raw,
    settings: storage.getItem(LEGACY_SETTINGS_KEY),
  });

  let migrated = 0;
  for (const old of legacy) {
    const existing = await tx<Thought | undefined>(
      'thoughts',
      'readonly',
      (s) => s.get(String(old.id)) as IDBRequest<Thought | undefined>,
    );
    if (!existing) {
      await put('thoughts', legacyThoughtToThought(old));
      migrated++;
    }
  }

  const oldSettings = storage.getItem(LEGACY_SETTINGS_KEY);
  if (oldSettings) {
    try {
      const s = JSON.parse(oldSettings) as { reminderEnabled?: boolean; reminderTime?: string };
      const current = await getSettings();
      await saveSettings({
        ...current,
        reminderEnabled: s.reminderEnabled ?? current.reminderEnabled,
        reminderTime: s.reminderTime ?? current.reminderTime,
      });
    } catch {
      /* настройки не критичны — backup уже сохранён */
    }
  }

  storage.removeItem(LEGACY_THOUGHTS_KEY);
  storage.removeItem(LEGACY_SETTINGS_KEY);
  return migrated;
}

/** Полный дамп для экспорта (и для backup перед будущими миграциями схемы). */
export async function exportAll() {
  return {
    version: DB_VERSION,
    exportedAt: Date.now(),
    thoughts: await allThoughts(),
    checkins: await allCheckins(),
    tasks: await allTasks(),
    capsules: await allCapsules(),
    settings: await getSettings(),
  };
}

export async function importAll(data: Awaited<ReturnType<typeof exportAll>>): Promise<number> {
  let count = 0;
  for (const th of data.thoughts ?? []) {
    await put('thoughts', th);
    count++;
  }
  for (const c of data.checkins ?? []) await put('checkins', c);
  for (const task of data.tasks ?? []) await put('tasks', task);
  for (const cap of data.capsules ?? []) await put('capsules', cap);
  if (data.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
  return count;
}

export async function wipeAll() {
  for (const s of ['thoughts', 'checkins', 'tasks', 'capsules', 'echoes', 'chat'] as const) {
    await clearStore(s);
  }
}

/** Только для тестов: закрыть соединение и удалить базу. */
export async function _resetDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
  }
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

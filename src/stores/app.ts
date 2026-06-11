import { aiAvailable, apiChat, apiDecompose, apiEmbeddings, apiSummarize, apiTone, configureApi } from '../services/api';
import { categorize, categorizeByKeywords } from '../services/categorize';
import * as db from '../services/db';
import { rebuildEchoes } from '../services/echo';
import { cancelNotification, notifyNow, scheduleNotification } from '../services/notifications';
import { buildChatContext, refreshProfileSummaryIfStale } from '../services/profile';
import { topKSimilar } from '../services/search';
import type {
  ChatMessage,
  EchoGroup,
  Level,
  Settings,
  StateCheckin,
  Task,
  Thought,
  TimeCapsule,
} from '../types';
import { createStore } from './store';

export type View = 'home' | 'chat' | 'state' | 'stats' | 'settings';

export interface AppState {
  ready: boolean;
  view: View;
  thoughts: Thought[];
  checkins: StateCheckin[];
  tasks: Task[];
  capsules: TimeCapsule[];
  echoes: EchoGroup[];
  chat: ChatMessage[];
  settings: Settings;
  filter: string;
  search: string;
  /** id → score из последнего семантического поиска (null = обычный поиск). */
  semanticIds: Map<string, number> | null;
  chatBusy: boolean;
  migratedCount: number;
  openedCapsules: TimeCapsule[];
}

export const app = createStore<AppState>({
  ready: false,
  view: 'home',
  thoughts: [],
  checkins: [],
  tasks: [],
  capsules: [],
  echoes: [],
  chat: [],
  settings: db.DEFAULT_SETTINGS,
  filter: 'Все',
  search: '',
  semanticIds: null,
  chatBusy: false,
  migratedCount: 0,
  openedCapsules: [],
});

function patch(p: Partial<AppState>) {
  app.update((s) => ({ ...s, ...p }));
}

function clientId(): string {
  let id = localStorage.getItem('mindvault_client_id');
  if (!id) {
    id = db.uid();
    localStorage.setItem('mindvault_client_id', id);
  }
  return id;
}

export function applyTheme(theme: Settings['theme']) {
  const dark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// ---------- init ----------

export async function initApp() {
  const migrated = await db.migrateFromLocalStorage(localStorage);
  const settings = await db.getSettings();
  configureApi(settings.apiUrl, settings.aiEnabled, clientId());
  applyTheme(settings.theme);

  const [thoughts, checkins, tasks, capsules, echoes, chat] = await Promise.all([
    db.allThoughts(),
    db.allCheckins(),
    db.allTasks(),
    db.allCapsules(),
    db.allEchoes(),
    db.allChat(),
  ]);
  thoughts.sort((a, b) => b.createdAt - a.createdAt);
  chat.sort((a, b) => a.createdAt - b.createdAt);

  patch({ ready: true, thoughts, checkins, tasks, capsules, echoes, chat, settings, migratedCount: migrated });

  await openDueCapsules();
  void runBackgroundJobs();
}

/** Фоновые ИИ-задачи: не блокируют UI, молча пропускаются офлайн. */
async function runBackgroundJobs() {
  const s = app.get();
  if (!aiAvailable()) return;
  await embedMissing();
  await refreshProfileSummaryIfStale(app.get().thoughts, s.checkins);
  if (s.settings.toneAnalysisEnabled) await analyzeMissingTones();
  await refreshEchoes();
}

/** Досчитать эмбеддинги для мыслей без вектора (батчами по 20). */
async function embedMissing() {
  const missing = app.get().thoughts.filter((t) => !t.embedding);
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const vectors = await apiEmbeddings(batch.map((t) => t.text));
    if (!vectors) return;
    for (let j = 0; j < batch.length; j++) {
      await saveThought({ ...batch[j], embedding: vectors[j] });
    }
  }
}

async function analyzeMissingTones() {
  const missing = app.get().thoughts.filter((t) => !t.tone).slice(0, 20);
  if (!missing.length) return;
  const tones = await apiTone(missing.map((t) => t.text));
  if (!tones) return;
  for (let i = 0; i < missing.length; i++) {
    await saveThought({ ...missing[i], tone: tones[i] });
  }
}

export async function refreshEchoes() {
  const s = app.get();
  const echoes = await rebuildEchoes(s.thoughts, s.settings.echoThreshold);
  patch({ echoes });
}

// ---------- thoughts ----------

async function saveThought(t: Thought) {
  await db.put('thoughts', t);
  app.update((s) => ({
    ...s,
    thoughts: s.thoughts.map((x) => (x.id === t.id ? t : x)),
  }));
}

export async function addThought(
  text: string,
  source: Thought['source'] = 'text',
): Promise<Thought> {
  const s = app.get();
  const categories = s.settings.categories.map((c) => c.name);
  const now = Date.now();
  const thought: Thought = {
    id: db.uid(),
    text: text.trim(),
    category: categorizeByKeywords(text, categories), // мгновенно, уточним ниже
    tags: [],
    createdAt: now,
    updatedAt: now,
    done: false,
    completedAt: null,
    closedAt: null,
    closeReason: null,
    embedding: null,
    tone: null,
    echoGroupId: null,
    linkedTaskIds: [],
    source,
  };
  await db.put('thoughts', thought);
  app.update((st) => ({ ...st, thoughts: [thought, ...st.thoughts] }));

  // Асинхронные уточнения: LLM-категория и эмбеддинг
  void (async () => {
    const cat = await categorize(text, categories);
    const vectors = await apiEmbeddings([text]);
    const fresh = app.get().thoughts.find((t) => t.id === thought.id);
    if (!fresh) return; // уже удалена
    await saveThought({ ...fresh, category: cat, embedding: vectors?.[0] ?? null });
    void refreshEchoes();
  })();

  return thought;
}

export async function editThought(id: string, text: string) {
  const t = app.get().thoughts.find((x) => x.id === id);
  if (!t) return;
  await saveThought({ ...t, text: text.trim(), updatedAt: Date.now(), embedding: null });
  void (async () => {
    const vectors = await apiEmbeddings([text]);
    const fresh = app.get().thoughts.find((x) => x.id === id);
    if (fresh && vectors) await saveThought({ ...fresh, embedding: vectors[0] });
  })();
}

export async function toggleDone(id: string) {
  const t = app.get().thoughts.find((x) => x.id === id);
  if (!t) return;
  await saveThought({
    ...t,
    done: !t.done,
    completedAt: !t.done ? Date.now() : null,
    updatedAt: Date.now(),
  });
}

let lastDeleted: { thought: Thought; tasks: Task[] } | null = null;

export async function deleteThought(id: string) {
  const s = app.get();
  const thought = s.thoughts.find((x) => x.id === id);
  if (!thought) return;
  lastDeleted = { thought, tasks: s.tasks.filter((t) => t.thoughtId === id) };
  await db.remove('thoughts', id);
  for (const task of lastDeleted.tasks) await db.remove('tasks', task.id);
  app.update((st) => ({
    ...st,
    thoughts: st.thoughts.filter((x) => x.id !== id),
    tasks: st.tasks.filter((x) => x.thoughtId !== id),
  }));
}

export async function undoDelete(): Promise<boolean> {
  if (!lastDeleted) return false;
  const { thought, tasks } = lastDeleted;
  lastDeleted = null;
  await db.put('thoughts', thought);
  for (const task of tasks) await db.put('tasks', task);
  app.update((s) => ({
    ...s,
    thoughts: [thought, ...s.thoughts].sort((a, b) => b.createdAt - a.createdAt),
    tasks: [...s.tasks, ...tasks],
  }));
  return true;
}

/** Анти-список: осознанно отпустить мысль (ритуал закрытия). */
export async function releaseThought(id: string, reason: string | null) {
  const t = app.get().thoughts.find((x) => x.id === id);
  if (!t) return;
  await saveThought({
    ...t,
    closedAt: Date.now(),
    closeReason: reason?.trim() || null,
    updatedAt: Date.now(),
  });
}

// ---------- семантический поиск ----------

export async function semanticSearch(query: string): Promise<boolean> {
  const vectors = await apiEmbeddings([query]);
  if (!vectors) return false;
  const scored = topKSimilar(vectors[0], app.get().thoughts, 20);
  patch({ semanticIds: new Map(scored.map(({ thought, score }) => [thought.id, score])) });
  return true;
}

export function clearSemantic() {
  patch({ semanticIds: null });
}

// ---------- капсулы времени ----------

export async function createCapsule(thoughtId: string, openAt: number) {
  const t = app.get().thoughts.find((x) => x.id === thoughtId);
  const notificationId = await scheduleNotification(
    openAt,
    'MindVault: капсула времени',
    t ? `Письмо от тебя из прошлого: «${t.text.slice(0, 80)}»` : 'Пора вскрыть капсулу',
  );
  const capsule: TimeCapsule = {
    id: db.uid(),
    thoughtId,
    createdAt: Date.now(),
    openAt,
    notificationId,
    openedAt: null,
  };
  await db.put('capsules', capsule);
  app.update((s) => ({ ...s, capsules: [...s.capsules, capsule] }));
}

/** Fallback для браузера: вскрыть капсулы, чей срок наступил, при открытии. */
export async function openDueCapsules() {
  const now = Date.now();
  const due = app.get().capsules.filter((c) => !c.openedAt && c.openAt <= now);
  if (!due.length) return;
  const opened: TimeCapsule[] = [];
  for (const c of due) {
    const upd = { ...c, openedAt: now };
    await db.put('capsules', upd);
    if (c.notificationId) await cancelNotification(c.notificationId);
    opened.push(upd);
    const t = app.get().thoughts.find((x) => x.id === c.thoughtId);
    if (t) notifyNow('MindVault: капсула времени', t.text.slice(0, 100));
  }
  app.update((s) => ({
    ...s,
    capsules: s.capsules.map((c) => opened.find((o) => o.id === c.id) ?? c),
    openedCapsules: opened,
  }));
}

export function dismissOpenedCapsules() {
  patch({ openedCapsules: [] });
}

// ---------- чек-ины ----------

export async function addCheckin(energy: Level, mood: Level, focus: Level, note: string | null) {
  const checkin: StateCheckin = {
    id: db.uid(),
    createdAt: Date.now(),
    energy,
    mood,
    focus,
    note: note?.trim() || null,
  };
  await db.put('checkins', checkin);
  app.update((s) => ({ ...s, checkins: [...s.checkins, checkin] }));
}

// ---------- задачи (ИИ-декомпозиция) ----------

export async function decomposeThought(thoughtId: string): Promise<Task[] | null> {
  const t = app.get().thoughts.find((x) => x.id === thoughtId);
  if (!t) return null;
  const steps = await apiDecompose(t.text);
  if (!steps) return null;
  const tasks: Task[] = steps.map((text, i) => ({
    id: db.uid(),
    thoughtId,
    text,
    done: false,
    order: i,
    createdAt: Date.now(),
  }));
  for (const task of tasks) await db.put('tasks', task);
  await saveThought({ ...t, linkedTaskIds: [...t.linkedTaskIds, ...tasks.map((x) => x.id)] });
  app.update((s) => ({ ...s, tasks: [...s.tasks, ...tasks] }));
  return tasks;
}

export async function toggleTask(id: string) {
  const task = app.get().tasks.find((x) => x.id === id);
  if (!task) return;
  const upd = { ...task, done: !task.done };
  await db.put('tasks', upd);
  app.update((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? upd : x)) }));
}

// ---------- чат-компаньон ----------

export async function sendChatMessage(text: string): Promise<void> {
  const userMsg: ChatMessage = { id: db.uid(), role: 'user', content: text, createdAt: Date.now() };
  await db.put('chat', userMsg);
  app.update((s) => ({ ...s, chat: [...s.chat, userMsg], chatBusy: true }));

  let context: string | null = null;
  const vectors = await apiEmbeddings([text]);
  if (vectors) {
    const relevant = topKSimilar(vectors[0], app.get().thoughts, 8);
    const profile = (await db.getProfileSummary())?.text ?? null;
    context = buildChatContext(relevant, profile);
  }

  const history = app
    .get()
    .chat.slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));
  const reply = await apiChat(history, context);

  const assistantMsg: ChatMessage = {
    id: db.uid(),
    role: 'assistant',
    content: reply ?? 'Сейчас я офлайн и не могу ответить. Все твои записи на месте — вернусь, как появится сеть.',
    createdAt: Date.now(),
  };
  await db.put('chat', assistantMsg);
  app.update((s) => ({ ...s, chat: [...s.chat, assistantMsg], chatBusy: false }));
}

// ---------- сводки ----------

export async function weeklySummary(): Promise<string | null> {
  const s = app.get();
  const weekAgo = Date.now() - 7 * 86400000;
  const thoughts = s.thoughts
    .filter((t) => t.createdAt >= weekAgo || (t.completedAt ?? 0) >= weekAgo)
    .map((t) => `[${t.category}${t.done ? ', закрыто' : ''}] ${t.text}`);
  const checkins = s.checkins
    .filter((c) => c.createdAt >= weekAgo)
    .map((c) => `энергия ${c.energy}/5, настроение ${c.mood}/5, фокус ${c.focus}/5`);
  if (!thoughts.length) return null;
  return apiSummarize('weekly', thoughts, checkins);
}

// ---------- настройки и данные ----------

export async function updateSettings(p: Partial<Settings>) {
  const settings = { ...app.get().settings, ...p };
  await db.saveSettings(settings);
  configureApi(settings.apiUrl, settings.aiEnabled, clientId());
  applyTheme(settings.theme);
  patch({ settings });
}

export async function exportData(): Promise<string> {
  return JSON.stringify(await db.exportAll(), null, 2);
}

export async function importData(json: string): Promise<number> {
  const data = JSON.parse(json);
  // Поддержка обоих форматов: полный экспорт v0.2 и массив мыслей из v0.1
  const count = Array.isArray(data)
    ? await (async () => {
        let n = 0;
        for (const old of data) {
          await db.put('thoughts', db.legacyThoughtToThought(old));
          n++;
        }
        return n;
      })()
    : await db.importAll(data);
  await initApp();
  return count;
}

export async function wipeAllData() {
  await db.wipeAll();
  await initApp();
}

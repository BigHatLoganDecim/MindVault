export type Tone = 'positive' | 'neutral' | 'anxious' | 'tired';
export type Level = 1 | 2 | 3 | 4 | 5;

export interface Thought {
  id: string;
  text: string;
  category: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  done: boolean;
  completedAt: number | null;
  /** «Закрыто» через Анти-список (осознанно отпущено, ≠ выполнено). */
  closedAt: number | null;
  closeReason: string | null;
  /** Вектор от прокси; хранится только локально. */
  embedding: number[] | null;
  tone: Tone | null;
  echoGroupId: string | null;
  linkedTaskIds: string[];
  source: 'text' | 'voice' | 'braindump' | 'migrated';
}

export interface StateCheckin {
  id: string;
  createdAt: number;
  energy: Level; // физический слой
  mood: Level; // эмоциональный слой
  focus: Level; // ментальный слой
  note: string | null;
}

export interface Task {
  id: string;
  thoughtId: string;
  text: string;
  done: boolean;
  order: number;
  createdAt: number;
}

export interface TimeCapsule {
  id: string;
  thoughtId: string;
  createdAt: number;
  openAt: number;
  notificationId: number | null;
  openedAt: number | null;
}

export interface EchoGroup {
  id: string;
  thoughtIds: string[];
  /** Пары, помеченные пользователем как ложные срабатывания. */
  dismissedIds: string[];
  updatedAt: number;
}

export interface ProfileSummary {
  text: string;
  builtAt: number;
}

export interface Category {
  name: string;
  emoji: string;
  /** false для встроенных категорий из v0.1. */
  custom: boolean;
}

export interface Settings {
  reminderEnabled: boolean;
  reminderTime: string;
  theme: 'auto' | 'light' | 'dark';
  apiUrl: string;
  aiEnabled: boolean;
  toneAnalysisEnabled: boolean;
  echoThreshold: number;
  categories: Category[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

/** Запись мысли из прототипа v0.1 (localStorage). */
export interface LegacyThought {
  id: number;
  text: string;
  category: string;
  created: number;
  done: boolean;
  completedAt: number | null;
}

/**
 * Клиент бэкенд-прокси. Каждый метод возвращает null при любой проблеме
 * (нет сети, нет URL, ИИ выключен, 5xx) — вызывающий код обязан иметь
 * офлайн-fallback. Приложение никогда не блокируется на ИИ.
 */
import type { Tone } from '../types';

let baseUrl = '';
let enabled = true;
let clientId = '';

export function configureApi(url: string, aiEnabled: boolean, id: string) {
  baseUrl = url.replace(/\/$/, '');
  enabled = aiEnabled;
  clientId = id;
}

export function aiAvailable(): boolean {
  return enabled && !!baseUrl && navigator.onLine;
}

async function post<T>(path: string, body: unknown, timeoutMs = 30000): Promise<T | null> {
  if (!aiAvailable()) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function apiCategorize(text: string, categories: string[]): Promise<string | null> {
  const r = await post<{ category: string }>('/categorize', { text, categories }, 10000);
  return r && categories.includes(r.category) ? r.category : null;
}

export async function apiEmbeddings(texts: string[]): Promise<number[][] | null> {
  const r = await post<{ vectors: number[][] }>('/embeddings', { texts });
  return r?.vectors ?? null;
}

export async function apiChat(
  messages: { role: string; content: string }[],
  context: string | null,
): Promise<string | null> {
  const r = await post<{ reply: string }>('/chat', { messages, context }, 60000);
  return r?.reply ?? null;
}

export async function apiSummarize(
  kind: 'weekly' | 'profile',
  thoughts: string[],
  checkins: string[],
): Promise<string | null> {
  const r = await post<{ summary: string }>('/summarize', { kind, thoughts, checkins }, 60000);
  return r?.summary ?? null;
}

export async function apiTone(texts: string[]): Promise<Tone[] | null> {
  const r = await post<{ tones: string[] }>('/tone', { texts });
  if (!r) return null;
  const valid: Tone[] = ['positive', 'neutral', 'anxious', 'tired'];
  return r.tones.map((t) => (valid.includes(t as Tone) ? (t as Tone) : 'neutral'));
}

export async function apiDecompose(text: string): Promise<string[] | null> {
  const r = await post<{ steps: string[] }>('/decompose', { text });
  return r?.steps?.length ? r.steps : null;
}

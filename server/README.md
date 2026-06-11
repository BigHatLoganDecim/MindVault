# MindVault — LLM-прокси

Тонкий stateless-бэкенд для local-first PWA MindVault. Все данные пользователя
живут на устройстве; сервер только проксирует запросы к OpenAI-совместимому
LLM-провайдеру (по умолчанию Groq). Ничего не хранит, пользовательские тексты
не логирует — только анонимные счётчики использования по фичам.

## Запуск

```bash
cd server
pip install -r requirements.txt
cp .env.example .env        # подставить LLM_API_KEY
uvicorn main:app --host 0.0.0.0 --port 8000
```

Без `LLM_API_KEY` сервер стартует, но LLM-эндпоинты отвечают
`503 {"detail": "llm_unavailable"}` — клиент уходит в офлайн-fallback.

## Конфигурация (env)

| Переменная | Default | Назначение |
|---|---|---|
| `LLM_API_KEY` | — | Ключ провайдера (fallback: `GROQ_API_KEY`) |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | Endpoint OpenAI-совместимого API |
| `LLM_MODEL_FAST` | `llama-3.1-8b-instant` | Категоризация, тон, сводки, декомпозиция |
| `LLM_MODEL_COMPANION` | `llama-3.3-70b-versatile` | Чат-компаньон |
| `LLM_FALLBACK_MODEL` | `llama-3.3-70b-versatile` | Авторетрай при ошибке основной модели |
| `LLM_TIMEOUT_SEC` | `30` | Таймаут запросов к LLM |
| `LLM_EMBED_MODEL` | `text-embedding-3-small` | Модель эмбеддингов |
| `LLM_EMBED_BASE_URL` | = `LLM_BASE_URL` | Отдельный провайдер эмбеддингов (у Groq их нет) |
| `LLM_EMBED_API_KEY` | = `LLM_API_KEY` | Ключ провайдера эмбеддингов |
| `CORS_ORIGINS` | `*` | Разрешённые origins, csv |
| `RATE_LIMIT_PER_MIN` | `30` | Запросов в минуту на клиента (X-Client-Id или IP) |
| `LOG_LEVEL` | `INFO` | Уровень логирования |

## Эндпоинты

| Метод | Путь | Запрос | Ответ | Модель |
|---|---|---|---|---|
| GET | `/health` | — | `{"status":"ok"}` | — |
| GET | `/usage` | — | `{feature: {requests, prompt_tokens, completion_tokens}}` | — |
| POST | `/embeddings` | `{texts: [str]}` (≤50) | `{vectors: [[float]]}` | embed |
| POST | `/categorize` | `{text, categories: [str]}` | `{category: str}` (если не из списка — последняя) | fast |
| POST | `/tone` | `{texts: [str]}` (≤20) | `{tones: ["positive"\|"neutral"\|"anxious"\|"tired"]}` | fast |
| POST | `/chat` | `{messages: [{role, content}], context: str\|null}` | `{reply: str}` | companion |
| POST | `/summarize` | `{kind: "weekly"\|"profile", thoughts: [str], checkins: [str]}` | `{summary: str}` | fast |
| POST | `/decompose` | `{text: str}` | `{steps: [str]}` (2–6 шагов) | fast |

Ошибки: `429 rate_limited` при превышении лимита, `503 llm_unavailable` при
недоступности LLM (сигнал клиенту перейти в офлайн-режим).

## Тесты

```bash
pip install pytest httpx
pytest -q
```

Тесты не делают реальных LLM-вызовов (клиент замокан).

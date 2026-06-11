"""
MindVault — тонкий stateless-прокси к LLM.

Все данные пользователя живут на устройстве (local-first PWA); сервер ничего
не хранит и не логирует из пользовательских текстов — только анонимные
счётчики использования по фичам.

Запуск:  uvicorn main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from llm import LLMClient, LLMError

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(),
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mindvault.server")

# ----------------------------------------------------------------- настройки

RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "30"))

MODEL_FAST = os.getenv("LLM_MODEL_FAST", "llama-3.1-8b-instant")
MODEL_COMPANION = os.getenv("LLM_MODEL_COMPANION", "llama-3.3-70b-versatile")

_cors_env = os.getenv("CORS_ORIGINS", "*")
CORS_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()] or ["*"]

llm = LLMClient.from_env()

app = FastAPI(title="MindVault LLM Proxy", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials="*" not in CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------- rate-limit (in-memory)

# {client_id: deque[float] — monotonic-время запросов за последнюю минуту}
_RATE: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request) -> None:
    """Простой скользящий лимит: N запросов в минуту на X-Client-Id (иначе IP)."""
    client_id = request.headers.get("X-Client-Id") or (
        request.client.host if request.client else "unknown")
    now = time.monotonic()
    q = _RATE[client_id]
    while q and now - q[0] > 60.0:
        q.popleft()
    if len(q) >= RATE_LIMIT_PER_MIN:
        raise HTTPException(status_code=429, detail="rate_limited")
    q.append(now)


# ------------------------------------------- анонимный учёт usage (in-memory)

USAGE: dict[str, dict[str, int]] = defaultdict(
    lambda: {"requests": 0, "prompt_tokens": 0, "completion_tokens": 0})


def _record_usage(feature: str) -> None:
    """Счётчики по фичам. Никаких пользовательских текстов — только числа."""
    u = getattr(llm, "last_usage", None) or {}
    c = USAGE[feature]
    c["requests"] += 1
    c["prompt_tokens"] += int(u.get("prompt_tokens", 0) or 0)
    c["completion_tokens"] += int(u.get("completion_tokens", 0) or 0)
    log.info("usage: feature=%s model=%s prompt_tokens=%s completion_tokens=%s",
             feature, u.get("model", ""), u.get("prompt_tokens", 0),
             u.get("completion_tokens", 0))


def _llm_guard(feature: str, call, *args, **kwargs):
    """Вызов LLM с graceful-обработкой: при ошибке — 503, клиент уйдёт в офлайн."""
    try:
        result = call(*args, **kwargs)
    except LLMError as e:
        log.warning("feature=%s: LLM недоступен (%s)", feature, e)
        raise HTTPException(status_code=503, detail="llm_unavailable")
    _record_usage(feature)
    return result


# ----------------------------------------------------------- pydantic-модели

class EmbeddingsRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=50)


class EmbeddingsResponse(BaseModel):
    vectors: list[list[float]]


class CategorizeRequest(BaseModel):
    text: str = Field(min_length=1)
    categories: list[str] = Field(min_length=1)


class CategorizeResponse(BaseModel):
    category: str


class ToneRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=20)


class ToneResponse(BaseModel):
    tones: list[str]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    context: str | None = None


class ChatResponse(BaseModel):
    reply: str


class SummarizeRequest(BaseModel):
    kind: Literal["weekly", "profile"]
    thoughts: list[str] = []
    checkins: list[str] = []


class SummarizeResponse(BaseModel):
    summary: str


class DecomposeRequest(BaseModel):
    text: str = Field(min_length=1)


class DecomposeResponse(BaseModel):
    steps: list[str]


# ----------------------------------------------------------------- эндпоинты

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/usage")
def usage():
    return {feature: dict(counters) for feature, counters in USAGE.items()}


@app.post("/embeddings", response_model=EmbeddingsResponse,
          dependencies=[Depends(rate_limit)])
def embeddings(req: EmbeddingsRequest):
    vectors = _llm_guard("embeddings", llm.embeddings, req.texts)
    return EmbeddingsResponse(vectors=vectors)


@app.post("/categorize", response_model=CategorizeResponse,
          dependencies=[Depends(rate_limit)])
def categorize(req: CategorizeRequest):
    system = (
        "Ты — классификатор личных заметок. Тебе дают текст заметки и список "
        "категорий. Выбери РОВНО ОДНУ категорию из списка, которая лучше всего "
        "подходит тексту. Не придумывай новых категорий.\n"
        'Отвечай строго одним JSON-объектом: {"category": "<категория из списка>"} '
        "— без пояснений и без markdown."
    )
    user = "Категории: " + ", ".join(req.categories) + "\n\nТекст заметки:\n" + req.text
    data = _llm_guard("categorize", llm.chat_json,
                      [{"role": "system", "content": system},
                       {"role": "user", "content": user}],
                      MODEL_FAST, temperature=0.0, max_tokens=100)
    answer = str(data.get("category", "")).strip()
    # Если модель вернула что-то не из списка — берём последнюю категорию
    # списка (договорённость: последняя = «прочее»).
    for cat in req.categories:
        if answer.casefold() == cat.casefold():
            return CategorizeResponse(category=cat)
    return CategorizeResponse(category=req.categories[-1])


_ALLOWED_TONES = ("positive", "neutral", "anxious", "tired")


@app.post("/tone", response_model=ToneResponse,
          dependencies=[Depends(rate_limit)])
def tone(req: ToneRequest):
    system = (
        "Ты — анализатор эмоционального тона коротких личных записей. Для "
        "КАЖДОГО текста определи тон — строго одно из значений: "
        "positive, neutral, anxious, tired.\n"
        'Отвечай строго одним JSON-объектом: {"tones": ["...", ...]} — массив '
        "той же длины и в том же порядке, что и входные тексты. Без пояснений."
    )
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(req.texts))
    data = _llm_guard("tone", llm.chat_json,
                      [{"role": "system", "content": system},
                       {"role": "user", "content": numbered}],
                      MODEL_FAST, temperature=0.0, max_tokens=300)
    raw = data.get("tones")
    raw = raw if isinstance(raw, list) else []
    tones: list[str] = []
    for i in range(len(req.texts)):
        value = str(raw[i]).strip().lower() if i < len(raw) else ""
        tones.append(value if value in _ALLOWED_TONES else "neutral")
    return ToneResponse(tones=tones)


_COMPANION_SYSTEM = """Ты — личный ИИ-компаньон в приложении MindVault, где человек хранит свои мысли и заметки.

Твоя личность: спокойный, тёплый, поддерживающий собеседник. Без навязчивости, без токсичной позитивности, без нравоучений и дежурных фраз. Обращаешься на «ты». Отвечаешь кратко и по делу, простым живым русским языком.

Ниже — контекст из записей пользователя (релевантные мысли и сводка профиля):
<context>
{context}
</context>

Правила работы с контекстом:
- Можешь ссылаться на мысли пользователя из контекста.
- Цитировать дословно — только когда это действительно необходимо.
- Никогда не выдумывай мысли, которых нет в контексте.
- Если контекст пуст или не относится к вопросу — честно скажи, что в записях ничего не нашлось, и отвечай из общих соображений."""


@app.post("/chat", response_model=ChatResponse,
          dependencies=[Depends(rate_limit)])
def chat(req: ChatRequest):
    context = (req.context or "").strip() or "(пусто — релевантных записей не найдено)"
    system = _COMPANION_SYSTEM.format(context=context)
    messages = [{"role": "system", "content": system}]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]
    reply = _llm_guard("chat", llm.chat, messages, MODEL_COMPANION,
                       temperature=0.7, max_tokens=800)
    return ChatResponse(reply=reply)


@app.post("/summarize", response_model=SummarizeResponse,
          dependencies=[Depends(rate_limit)])
def summarize(req: SummarizeRequest):
    if req.kind == "profile":
        system = (
            "Ты — аналитик личных заметок. По мыслям и чек-инам пользователя "
            "составь компактный портрет (не более ~500 токенов) на русском: "
            "активные темы, повторяющиеся заботы, динамика эмоциональных "
            "состояний. Пиши сжато, фактами, без воды и без оценочных суждений. "
            "Этот портрет будет использоваться как память компаньона."
        )
        max_tokens = 600
    else:
        system = (
            "Ты — дружелюбный помощник. По мыслям и чек-инам пользователя за "
            "неделю составь краткую тёплую сводку недели на русском: что "
            "занимало человека, какое было настроение, что заметно изменилось. "
            "Обращайся на «ты», без токсичной позитивности, 3–6 предложений."
        )
        max_tokens = 400
    parts = []
    if req.thoughts:
        parts.append("Мысли:\n" + "\n".join(f"- {t}" for t in req.thoughts))
    if req.checkins:
        parts.append("Чек-ины состояния:\n" + "\n".join(f"- {c}" for c in req.checkins))
    user = "\n\n".join(parts) or "(записей нет)"
    summary = _llm_guard("summarize", llm.chat,
                         [{"role": "system", "content": system},
                          {"role": "user", "content": user}],
                         MODEL_FAST, temperature=0.4, max_tokens=max_tokens)
    return SummarizeResponse(summary=summary)


@app.post("/decompose", response_model=DecomposeResponse,
          dependencies=[Depends(rate_limit)])
def decompose(req: DecomposeRequest):
    system = (
        "Ты — помощник по планированию. Разбей мысль или задачу пользователя "
        "на 2–6 конкретных, выполнимых шагов на русском языке. Каждый шаг — "
        "короткая формулировка действия.\n"
        'Отвечай строго одним JSON-объектом: {"steps": ["шаг 1", "шаг 2", ...]} '
        "— без пояснений и без markdown."
    )
    data = _llm_guard("decompose", llm.chat_json,
                      [{"role": "system", "content": system},
                       {"role": "user", "content": req.text}],
                      MODEL_FAST, temperature=0.3, max_tokens=400)
    raw = data.get("steps")
    raw = raw if isinstance(raw, list) else []
    steps = [str(s).strip() for s in raw if str(s).strip()][:6]
    if not steps:
        log.warning("decompose: модель не вернула шагов")
        raise HTTPException(status_code=503, detail="llm_unavailable")
    return DecomposeResponse(steps=steps)

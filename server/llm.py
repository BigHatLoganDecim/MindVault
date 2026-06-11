"""
Универсальный LLM-клиент через OpenAI-совместимый API (адаптация под MindVault).

Поддерживает любого провайдера со стандартом OpenAI:
  - Groq (по умолчанию)
  - OpenRouter, DeepSeek, VseGPT, OpenAI и любой другой OpenAI-compat

Конфигурация — через env-переменные:
  LLM_API_KEY        — ключ (если не задан, fallback на GROQ_API_KEY)
  LLM_BASE_URL       — endpoint (default https://api.groq.com/openai/v1)
  LLM_FALLBACK_MODEL — запасная модель при ошибках основной
  LLM_TIMEOUT_SEC    — таймаут запросов (default 30)

Эмбеддинги (у Groq их может не быть — можно указать отдельного провайдера):
  LLM_EMBED_MODEL    — модель эмбеддингов (default text-embedding-3-small)
  LLM_EMBED_BASE_URL — endpoint для эмбеддингов (fallback на LLM_BASE_URL)
  LLM_EMBED_API_KEY  — ключ для эмбеддингов (fallback на LLM_API_KEY)
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

log = logging.getLogger("mindvault.llm")

DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"

# Запасная модель по умолчанию — если основная (per-feature) вернёт ошибку
# (снята с обслуживания / 400 model not found / rate-limit по конкретной
# модели), chat() автоматически ретраит на ней.
DEFAULT_FALLBACK_MODEL = "llama-3.3-70b-versatile"

DEFAULT_EMBED_MODEL = "text-embedding-3-small"

# Подстроки ошибок, при которых fallback БЕСПОЛЕЗЕН — не тратим время/токены
# на повтор (проблема в ключе/доступе/квоте, а не в модели).
_NO_RETRY_MARKERS = (
    "401", "invalid_api_key", "authentication", "unauthorized",
    "permission", "no such organization", "insufficient_quota",
)


class LLMError(RuntimeError):
    """Любая невосстановимая ошибка LLM — сервер отвечает 503, клиент уходит в офлайн-fallback."""


class LLMClient:
    """OpenAI-совместимый LLM-клиент: chat / chat_json / embeddings.

    Никаких пользовательских текстов не логирует — только модели, коды
    ошибок и счётчики токенов.
    """

    def __init__(self,
                 api_key: str,
                 base_url: str = DEFAULT_BASE_URL,
                 timeout_sec: float = 30.0,
                 fallback_model: str | None = None,
                 embed_api_key: str | None = None,
                 embed_base_url: str | None = None,
                 embed_model: str = DEFAULT_EMBED_MODEL):
        self.api_key = api_key
        self.base_url = base_url
        self.timeout = timeout_sec
        self.fallback_model = (fallback_model or "").strip() or DEFAULT_FALLBACK_MODEL
        self.embed_model = (embed_model or "").strip() or DEFAULT_EMBED_MODEL
        # Отдельные креды для эмбеддингов с fallback на основные
        self.embed_api_key = (embed_api_key or "").strip() or api_key
        self.embed_base_url = (embed_base_url or "").strip() or base_url

        self._client = None
        self._embed_client = None
        # Usage последнего успешного вызова — для анонимизированного учёта
        self.last_usage: dict[str, Any] = {"prompt_tokens": 0, "completion_tokens": 0, "model": ""}

        if not api_key:
            log.info("LLM: API ключ не задан — LLM отключён (все вызовы дадут LLMError)")
            return

        try:
            from openai import OpenAI  # type: ignore
            self._client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout_sec)
            if self.embed_api_key:
                if self.embed_api_key == api_key and self.embed_base_url == base_url:
                    self._embed_client = self._client
                else:
                    self._embed_client = OpenAI(api_key=self.embed_api_key,
                                                base_url=self.embed_base_url,
                                                timeout=timeout_sec)
            log.info("LLM: клиент инициализирован, base_url=%s, fallback=%s, embed_base_url=%s",
                     base_url, self.fallback_model, self.embed_base_url)
        except Exception as e:
            log.warning("LLM: не удалось инициализировать клиент (%s) — отключён", e)
            self._client = None
            self._embed_client = None

    @classmethod
    def from_env(cls) -> "LLMClient":
        return cls(
            api_key=os.getenv("LLM_API_KEY") or os.getenv("GROQ_API_KEY") or "",
            base_url=os.getenv("LLM_BASE_URL", "").strip() or DEFAULT_BASE_URL,
            timeout_sec=float(os.getenv("LLM_TIMEOUT_SEC", "30")),
            fallback_model=os.getenv("LLM_FALLBACK_MODEL"),
            embed_api_key=os.getenv("LLM_EMBED_API_KEY"),
            embed_base_url=os.getenv("LLM_EMBED_BASE_URL"),
            embed_model=os.getenv("LLM_EMBED_MODEL", DEFAULT_EMBED_MODEL),
        )

    @property
    def enabled(self) -> bool:
        return self._client is not None

    # ------------------------------------------------------------------ chat

    def chat(self, messages: list[dict], model: str,
             temperature: float = 0.5, max_tokens: int = 600,
             extra: dict | None = None) -> str:
        """Вызов chat completions. Возвращает текст ответа или кидает LLMError.

        При ошибке основной модели автоматически ретраит на fallback-модели —
        кроме случаев, когда ретрай бесполезен (ключ/доступ/квота).
        """
        if self._client is None:
            raise LLMError("llm_disabled: API ключ не задан")
        params: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if extra:
            params.update(extra)
        try:
            return self._create(params)
        except Exception as e:
            log.warning("LLM.chat (%s): %s", model, e)
            err = str(e).lower()
            if (model != self.fallback_model
                    and not any(m in err for m in _NO_RETRY_MARKERS)):
                log.warning("LLM.chat: пробую запасную модель %s вместо %s",
                            self.fallback_model, model)
                fb_params = dict(params, model=self.fallback_model)
                try:
                    return self._create(fb_params)
                except Exception as e2:
                    log.warning("LLM.chat fallback (%s): %s", self.fallback_model, e2)
                    raise LLMError(f"fallback failed: {e2}") from e2
            raise LLMError(str(e)) from e

    def _create(self, params: dict[str, Any]) -> str:
        resp = self._client.chat.completions.create(**params)
        self._track(resp, params["model"])
        text = (resp.choices[0].message.content or "").strip()
        if not text:
            raise ValueError("empty completion")
        return text

    def chat_json(self, messages: list[dict], model: str,
                  temperature: float = 0.0, max_tokens: int = 600) -> dict[str, Any]:
        """То же, что chat(), но с response_format=json_object и парсингом JSON.

        Если провайдер не поддерживает response_format — ретраит без него
        (JSON всё равно выдирается из текста, в т.ч. из markdown-обёртки).
        """
        extra = {"response_format": {"type": "json_object"}}
        try:
            text = self.chat(messages, model, temperature, max_tokens, extra=extra)
        except LLMError as e:
            if "response_format" not in str(e).lower():
                raise
            log.warning("LLM.chat_json: провайдер не принял response_format — повтор без него")
            text = self.chat(messages, model, temperature, max_tokens)
        data = extract_json(text)
        if data is None:
            raise LLMError("invalid_json_from_model")
        return data

    # ------------------------------------------------------------ embeddings

    def embeddings(self, texts: list[str], model: str | None = None) -> list[list[float]]:
        """Эмбеддинги через client.embeddings.create. Кидает LLMError при сбое."""
        if self._embed_client is None:
            raise LLMError("embeddings_disabled: API ключ не задан")
        use_model = (model or "").strip() or self.embed_model
        try:
            resp = self._embed_client.embeddings.create(model=use_model, input=texts)
        except Exception as e:
            log.warning("LLM.embeddings (%s): %s", use_model, e)
            raise LLMError(str(e)) from e
        self._track(resp, use_model)
        items = sorted(resp.data, key=lambda d: getattr(d, "index", 0))
        return [list(item.embedding) for item in items]

    # --------------------------------------------------------------- helpers

    def _track(self, resp: Any, model_used: str) -> None:
        """Извлекает usage из ответа (если есть) — без какого-либо текста."""
        try:
            usage = getattr(resp, "usage", None)
            self.last_usage = {
                "prompt_tokens": int(getattr(usage, "prompt_tokens", 0) or 0) if usage else 0,
                "completion_tokens": int(getattr(usage, "completion_tokens", 0) or 0) if usage else 0,
                "model": model_used,
            }
        except Exception as e:
            log.debug("LLM._track: %s", e)


def extract_json(text: str) -> dict[str, Any] | None:
    """Выдирает JSON-объект из ответа модели, в т.ч. из markdown-обёртки ```json ...```."""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        text = brace.group(0)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        log.warning("LLM: ответ модели не парсится как JSON (длина %d)", len(text))
        return None
    return data if isinstance(data, dict) else None

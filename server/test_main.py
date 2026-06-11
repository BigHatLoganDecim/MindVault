"""Тесты MindVault LLM-прокси. Реальных LLM-вызовов нет — клиент замокан."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main


class StubLLM:
    """Заглушка LLMClient: возвращает заранее заданные ответы, считает вызовы."""

    def __init__(self):
        self.last_usage = {"prompt_tokens": 11, "completion_tokens": 7, "model": "stub-model"}
        self.chat_result = "тестовый ответ"
        self.chat_json_result: dict = {}
        self.calls: list[tuple] = []

    def chat(self, messages, model, temperature=0.5, max_tokens=600, extra=None):
        self.calls.append(("chat", model))
        return self.chat_result

    def chat_json(self, messages, model, temperature=0.0, max_tokens=600):
        self.calls.append(("chat_json", model))
        return self.chat_json_result

    def embeddings(self, texts, model=None):
        self.calls.append(("embeddings", model))
        return [[0.1, 0.2, 0.3] for _ in texts]


@pytest.fixture()
def stub(monkeypatch):
    s = StubLLM()
    monkeypatch.setattr(main, "llm", s)
    main.USAGE.clear()
    main._RATE.clear()
    return s


@pytest.fixture()
def client(stub):
    return TestClient(main.app)


# ----------------------------------------------------------------- /health

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# -------------------------------------------------------------- rate-limit

def test_rate_limit_429(client, stub, monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT_PER_MIN", 3)
    stub.chat_json_result = {"steps": ["шаг"]}
    headers = {"X-Client-Id": "rl-test"}
    for _ in range(3):
        r = client.post("/decompose", json={"text": "разобрать завал"}, headers=headers)
        assert r.status_code == 200
    r = client.post("/decompose", json={"text": "разобрать завал"}, headers=headers)
    assert r.status_code == 429


def test_rate_limit_is_per_client(client, stub, monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT_PER_MIN", 1)
    stub.chat_json_result = {"steps": ["шаг"]}
    assert client.post("/decompose", json={"text": "x"},
                       headers={"X-Client-Id": "a"}).status_code == 200
    assert client.post("/decompose", json={"text": "x"},
                       headers={"X-Client-Id": "a"}).status_code == 429
    # Другой клиент не задет
    assert client.post("/decompose", json={"text": "x"},
                       headers={"X-Client-Id": "b"}).status_code == 200


# -------------------------------------------------------------- /categorize

def test_categorize_returns_category_from_list(client, stub):
    stub.chat_json_result = {"category": "работа"}
    r = client.post("/categorize", json={
        "text": "надо доделать отчёт до пятницы",
        "categories": ["работа", "здоровье", "прочее"],
    })
    assert r.status_code == 200
    assert r.json() == {"category": "работа"}
    # Использована быстрая модель
    assert ("chat_json", main.MODEL_FAST) in stub.calls


def test_categorize_unknown_answer_falls_back_to_last(client, stub):
    stub.chat_json_result = {"category": "несуществующая категория"}
    r = client.post("/categorize", json={
        "text": "какая-то мысль",
        "categories": ["работа", "здоровье", "прочее"],
    })
    assert r.status_code == 200
    assert r.json() == {"category": "прочее"}


def test_categorize_503_when_llm_down(client, stub, monkeypatch):
    def boom(*a, **kw):
        raise main.LLMError("down")
    monkeypatch.setattr(stub, "chat_json", boom)
    r = client.post("/categorize", json={"text": "x", "categories": ["a", "b"]})
    assert r.status_code == 503
    assert r.json() == {"detail": "llm_unavailable"}


# -------------------------------------------------------------------- /tone

def test_tone_validates_values(client, stub):
    # Модель вернула одно валидное значение, одно мусорное и забыла третье
    stub.chat_json_result = {"tones": ["positive", "ярость", ]}
    r = client.post("/tone", json={"texts": ["хорошо", "плохо", "устал"]})
    assert r.status_code == 200
    tones = r.json()["tones"]
    assert tones == ["positive", "neutral", "neutral"]
    assert all(t in ("positive", "neutral", "anxious", "tired") for t in tones)


def test_tone_batch_limit(client, stub):
    stub.chat_json_result = {"tones": ["neutral"] * 21}
    r = client.post("/tone", json={"texts": ["t"] * 21})
    assert r.status_code == 422  # больше 20 текстов — отклоняется валидацией


# --------------------------------------------------------------- /decompose

def test_decompose(client, stub):
    stub.chat_json_result = {"steps": ["открыть документ", "написать план", "  ", "отправить"]}
    r = client.post("/decompose", json={"text": "сделать отчёт"})
    assert r.status_code == 200
    assert r.json() == {"steps": ["открыть документ", "написать план", "отправить"]}


def test_decompose_caps_at_six_steps(client, stub):
    stub.chat_json_result = {"steps": [f"шаг {i}" for i in range(10)]}
    r = client.post("/decompose", json={"text": "большая задача"})
    assert r.status_code == 200
    assert len(r.json()["steps"]) == 6


# ------------------------------------------------------------------- /usage

def test_usage_counters(client, stub):
    stub.chat_json_result = {"category": "работа"}
    for _ in range(2):
        assert client.post("/categorize", json={
            "text": "x", "categories": ["работа", "прочее"]}).status_code == 200

    stub.chat_result = "сводка недели"
    assert client.post("/summarize", json={
        "kind": "weekly", "thoughts": ["мысль"], "checkins": []}).status_code == 200

    r = client.get("/usage")
    assert r.status_code == 200
    data = r.json()
    assert data["categorize"] == {
        "requests": 2, "prompt_tokens": 22, "completion_tokens": 14}
    assert data["summarize"]["requests"] == 1
    # Никаких пользовательских текстов в учёте — только числа
    for counters in data.values():
        assert set(counters) == {"requests", "prompt_tokens", "completion_tokens"}
        assert all(isinstance(v, int) for v in counters.values())


def test_usage_not_counted_on_llm_failure(client, stub, monkeypatch):
    def boom(*a, **kw):
        raise main.LLMError("down")
    monkeypatch.setattr(stub, "chat_json", boom)
    client.post("/categorize", json={"text": "x", "categories": ["a"]})
    assert "categorize" not in client.get("/usage").json()


# -------------------------------------------------------------- /embeddings

def test_embeddings(client, stub):
    r = client.post("/embeddings", json={"texts": ["раз", "два"]})
    assert r.status_code == 200
    assert r.json() == {"vectors": [[0.1, 0.2, 0.3], [0.1, 0.2, 0.3]]}


def test_embeddings_limit_50(client, stub):
    r = client.post("/embeddings", json={"texts": ["t"] * 51})
    assert r.status_code == 422


# -------------------------------------------------------------------- /chat

def test_chat_uses_companion_model_and_context(client, stub):
    stub.chat_result = "привет!"
    r = client.post("/chat", json={
        "messages": [{"role": "user", "content": "как дела?"}],
        "context": "мысль: хочу научиться рисовать",
    })
    assert r.status_code == 200
    assert r.json() == {"reply": "привет!"}
    assert ("chat", main.MODEL_COMPANION) in stub.calls

"""Сесії Activity: короткий підписаний токен (HMAC-SHA256) без сторонніх бібліотек.

Формат: base64url(JSON) + "." + base64url(HMAC). Усередині — Discord id, ім'я, аватар і час завершення.
Токен видає POST /api/token після обміну OAuth2-коду; далі фронтенд передає його в
заголовку Authorization: Bearer … (HTTP) або першим повідомленням {"type":"auth"} (WebSocket).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass

SESSION_TTL = 12 * 3600


@dataclass(frozen=True, slots=True)
class Identity:
    user_id: int
    name: str
    avatar: str | None = None
    dev: bool = False  # DEV_MODE: користувач узятий з ?user=, без Discord-авторизації


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(secret: str, body: str) -> str:
    return _b64(hmac.new(secret.encode(), body.encode("ascii"), hashlib.sha256).digest())


def issue(secret: str, *, user_id: int, name: str, avatar: str | None, ttl: int = SESSION_TTL) -> str:
    payload = {"uid": str(user_id), "name": name, "av": avatar, "exp": int(time.time()) + ttl}
    body = _b64(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
    return f"{body}.{_sign(secret, body)}"


def verify(secret: str, token: str | None) -> Identity | None:
    """Identity або None, якщо токен підроблений, зіпсований чи прострочений."""
    if not token or token.count(".") != 1:
        return None
    body, signature = token.split(".")
    if not hmac.compare_digest(signature, _sign(secret, body)):
        return None
    try:
        payload = json.loads(_unb64(body))
        if int(payload["exp"]) < time.time():
            return None
        return Identity(user_id=int(payload["uid"]), name=str(payload.get("name") or ""), avatar=payload.get("av"))
    except (ValueError, KeyError, TypeError):
        return None

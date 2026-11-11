"""Помилка API з HTTP-статусом і текстом для користувача."""

from __future__ import annotations


class ApiError(Exception):
    """code — машинний код для фронтенду (наприклад, summon_required: треба спершу покликати бота)."""

    def __init__(self, status: int, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code

"""Налаштування бота з .env."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
COOKIES_FILE = BASE_DIR / "cookies.txt"
DB_FILE = BASE_DIR / "data" / "adolfik.db"  # профілі, лайки, плейлисти Activity (data/ у .gitignore)

DEFAULT_COLOR = 0x8B5CF6  # фіолетовий акцент


def _parse_color(raw: str | None) -> int:
    if not raw:
        return DEFAULT_COLOR
    raw = raw.strip().lstrip("#")
    if raw.lower().startswith("0x"):
        raw = raw[2:]
    try:
        return int(raw, 16) & 0xFFFFFF
    except ValueError:
        return DEFAULT_COLOR


def _parse_int(raw: str | None, default: int, lo: int, hi: int) -> int:
    try:
        value = int(raw) if raw else default
    except ValueError:
        value = default
    return max(lo, min(hi, value))


def find_ffmpeg() -> str | None:
    """bin/ffmpeg.exe поруч із ботом, інакше ffmpeg з PATH."""
    local = BASE_DIR / "bin" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if local.is_file():
        return str(local)
    return shutil.which("ffmpeg")


def _parse_bool(raw: str | None) -> bool:
    return (raw or "").strip().lower() in {"1", "true", "yes", "on", "так"}


def _parse_id(raw: str | None) -> int | None:
    raw = (raw or "").strip()
    return int(raw) if raw.isdigit() else None


@dataclass(frozen=True, slots=True)
class Settings:
    token: str
    default_volume: int
    embed_color: int
    guild_id: int | None
    ffmpeg: str | None
    # ----- Discord Activity (веб-сервер усередині бота) -----
    client_id: int | None = None  # порожньо = id застосунку бота
    client_secret: str = ""  # OAuth2 → Client Secret; без нього (і без DEV_MODE) веб-сервер вимкнений
    web_host: str = "127.0.0.1"  # тільки локально: назовні його виставляє тунель (cloudflared)
    web_port: int = 8080
    session_secret: str = ""  # підпис сесій Activity; порожньо = випадковий при кожному запуску
    dev_mode: bool = False  # локальна розробка без Discord-авторизації (НЕ вмикати з тунелем)
    dev_user_id: int | None = None  # DEV_MODE: від імені кого діяти, якщо не передано ?user=

    @property
    def web_enabled(self) -> bool:
        return bool(self.client_secret) or self.dev_mode

    @classmethod
    def load(cls) -> Settings:
        load_dotenv(BASE_DIR / ".env")
        return cls(
            token=os.getenv("DISCORD_TOKEN", "").strip(),
            default_volume=_parse_int(os.getenv("DEFAULT_VOLUME"), 50, 0, 150),
            embed_color=_parse_color(os.getenv("EMBED_COLOR")),
            guild_id=_parse_id(os.getenv("GUILD_ID")),
            ffmpeg=find_ffmpeg(),
            client_id=_parse_id(os.getenv("DISCORD_CLIENT_ID")),
            client_secret=os.getenv("DISCORD_CLIENT_SECRET", "").strip(),
            web_host=os.getenv("WEB_HOST", "").strip() or "127.0.0.1",
            web_port=_parse_int(os.getenv("WEB_PORT"), 8080, 1, 65535),
            session_secret=os.getenv("SESSION_SECRET", "").strip(),
            dev_mode=_parse_bool(os.getenv("DEV_MODE")),
            dev_user_id=_parse_id(os.getenv("DEV_USER_ID")),
        )

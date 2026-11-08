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


@dataclass(frozen=True, slots=True)
class Settings:
    token: str
    default_volume: int
    embed_color: int
    guild_id: int | None
    ffmpeg: str | None

    @classmethod
    def load(cls) -> Settings:
        load_dotenv(BASE_DIR / ".env")
        guild_raw = os.getenv("GUILD_ID", "").strip()
        return cls(
            token=os.getenv("DISCORD_TOKEN", "").strip(),
            default_volume=_parse_int(os.getenv("DEFAULT_VOLUME"), 50, 0, 150),
            embed_color=_parse_color(os.getenv("EMBED_COLOR")),
            guild_id=int(guild_raw) if guild_raw.isdigit() else None,
            ffmpeg=find_ffmpeg(),
        )

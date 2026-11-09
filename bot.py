"""Adolfik — музичний Discord-бот для YouTube.

Запуск:  python bot.py            (або start.bat)
Перевірка: python bot.py --check  (логін, синхронізація slash-команд і вихід)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import logging
import platform
import re
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import discord
from discord import app_commands
from discord.ext import commands

from config import BASE_DIR, COOKIES_FILE, LOG_DIR, Settings
from player import PlayerManager
from stations import StationManager
from ui import embeds
from ui.checks import reply_error
from ui.colors import ColorPicker
from ui.panels import NowPlayingPanel
from ui.views import LegacyPanelButtons
from webapi.server import ActivityServer
from youtube import YouTube

log = logging.getLogger("adolfik")

DAVEY_MIN = (0, 1, 7)
DAVEY_MAX_EXCLUSIVE = (0, 2)
SYNC_TIMEOUT = 60
SYNC_STAMP = BASE_DIR / "data" / "commands.sha256"


ENTRY_POINT_TYPE = 4  # PRIMARY_ENTRY_POINT — команда запуску Activity, яку створює Discord
_ENTRY_POINT_KEYS = (
    "name",
    "type",
    "description",
    "handler",
    "integration_types",
    "contexts",
    "default_member_permissions",
    "nsfw",
    "name_localizations",
    "description_localizations",
)


def _entry_point_payload(command: dict[str, Any]) -> dict[str, Any]:
    """Entry Point-команда з Discord у вигляді, придатному для bulk overwrite (без id/version/application_id)."""
    return {k: command[k] for k in _ENTRY_POINT_KEYS if command.get(k) is not None}


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


INVITE_PERMISSIONS = discord.Permissions(
    view_channel=True,
    send_messages=True,
    embed_links=True,
    read_message_history=True,
    manage_messages=True,  # прибирати повідомлення в музичному каналі
    manage_channels=True,  # /setup створює канал сам
    connect=True,
    speak=True,
    use_application_commands=True,
)


def setup_logging() -> None:
    # Консоль Windows може бути в cp1251 — емодзі в логах не мають валити бота.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass

    LOG_DIR.mkdir(exist_ok=True)
    plain = logging.Formatter("[{asctime}] [{levelname:<8}] {name}: {message}", "%Y-%m-%d %H:%M:%S", style="{")
    file_handler = RotatingFileHandler(LOG_DIR / "bot.log", maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    file_handler.setFormatter(plain)

    console = logging.StreamHandler()
    colour = getattr(discord.utils, "_ColourFormatter", None)
    console.setFormatter(colour() if colour and discord.utils.stream_supports_colour(console.stream) else plain)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers[:] = [file_handler, console]


def _version(package: str) -> str | None:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


def preflight(settings: Settings) -> list[str]:
    """Перевірки до запуску. Повертає список фатальних проблем."""
    davey_version = _version("davey")
    log.info(
        "Python %s | discord.py %s | davey %s | yt-dlp %s | %s",
        platform.python_version(),
        discord.__version__,
        davey_version,
        _version("yt-dlp"),
        platform.platform(),
    )
    problems: list[str] = []

    if not settings.token:
        problems.append("DISCORD_TOKEN порожній — заповни .env (приклад у .env.example).")

    if settings.ffmpeg:
        log.info("ffmpeg: %s", settings.ffmpeg)
    else:
        problems.append("Не знайшов ffmpeg: поклади ffmpeg.exe у папку bin\\ або додай ffmpeg у PATH.")

    if davey_version is None:
        problems.append('Не встановлено davey (DAVE-шифрування войсу). Виконай: pip install "davey>=0.1.7,<0.2"')
    else:
        parts = tuple(int(x) for x in re.findall(r"\d+", davey_version)[:3])
        if not (DAVEY_MIN <= parts < DAVEY_MAX_EXCLUSIVE):
            problems.append(
                f"davey {davey_version} не підходить: потрібна >=0.1.7,<0.2. З davey 0.2.x бот підключається "
                'до войсу, але звуку нема. Виконай: pip install "davey>=0.1.7,<0.2"'
            )
    try:
        from discord import voice_state

        if not getattr(voice_state, "has_dave", False):
            problems.append("discord.py не бачить davey — DAVE-войс не запрацює.")
    except ImportError:
        log.warning("Стара версія discord.py без DAVE — онови з GitHub (див. requirements.txt).")

    if not discord.opus.is_loaded():
        try:
            discord.opus._load_default()
        except OSError:
            pass
    if discord.opus.is_loaded():
        log.info("Opus завантажено")
    else:
        problems.append("Не вдалося завантажити бібліотеку Opus (libopus).")

    log.info(
        "cookies.txt: %s", "знайдено, yt-dlp його використає" if COOKIES_FILE.is_file() else "нема (не обов'язково)"
    )
    return problems


class Adolfik(commands.Bot):
    def __init__(self, settings: Settings, *, check_only: bool = False) -> None:
        intents = discord.Intents.default()  # guilds, voice_states, guild_messages
        # Привілейований: потрібен музичному каналу, щоб бачити назви пісень.
        # Увімкни в Developer Portal -> Bot -> Message Content Intent.
        intents.message_content = True
        super().__init__(
            command_prefix=commands.when_mentioned,  # префіксних команд нема, тільки slash
            intents=intents,
            help_command=None,
            # Тексти панелі (Components V2) поводяться як content — без цього <@id> пінгував би людей.
            allowed_mentions=discord.AllowedMentions.none(),
            activity=discord.Activity(type=discord.ActivityType.listening, name="/play"),
            allowed_contexts=app_commands.AppCommandContext(guild=True, dm_channel=False, private_channel=False),
            allowed_installs=app_commands.AppInstallationType(guild=True, user=False),
        )
        self.settings = settings
        self.check_only = check_only
        self.yt = YouTube()
        self.colors = ColorPicker(settings.embed_color)
        self.players = PlayerManager(self)
        self.stations = StationManager(self)
        self.web = ActivityServer(self)  # Discord Activity: API + WebSocket + фронтенд
        self.tree.error(self._on_app_command_error)
        self._background: set[asyncio.Task[None]] = set()

    async def setup_hook(self) -> None:
        embeds.configure(self.settings.embed_color)
        await self.load_extension("cogs.music")
        await self.load_extension("cogs.station")
        # Persistent: кнопки й меню черги працюють і на панелях, надісланих до перезапуску бота.
        self.add_view(NowPlayingPanel())
        self.add_view(LegacyPanelButtons())  # «📜 Черга» на старих embed-панелях
        await self.web.start()  # той самий event loop: API має прямий доступ до bot.players і bot.yt
        # Синхронізація у фоні: якщо Discord притримає її rate limit-ом, бот однаково підключиться.
        self._sync_task = asyncio.create_task(self._sync_commands())
        if not self.check_only:
            task = asyncio.create_task(self._warmup())
            self._background.add(task)
            task.add_done_callback(self._background.discard)

    async def _remote_commands(self, guild: discord.abc.Snowflake | None) -> list[dict[str, Any]]:
        assert self.application_id is not None
        if guild is None:
            return list(await self.http.get_global_commands(self.application_id))
        return list(await self.http.get_guild_commands(self.application_id, guild.id))

    async def _sync_commands(self) -> None:
        """Синхронізація slash-команд, яка не видаляє Entry Point-команду Activity.

        Коли в Developer Portal увімкнено Activities, Discord створює команду типу PRIMARY_ENTRY_POINT
        («Launch»). discord.py про неї не знає, а масове перезаписування без неї Discord відхиляє,
        тому беремо її з Discord і додаємо в payload як є.
        """
        guild = discord.Object(id=self.settings.guild_id) if self.settings.guild_id else None
        if guild:
            self.tree.copy_global_to(guild=guild)
            scope = f"на сервері {guild.id}"
        else:
            scope = "глобально"
        local = [cmd.to_dict(self.tree) for cmd in self.tree.get_commands(guild=guild)]
        names = sorted(c["name"] for c in local)
        digest = hashlib.sha256(
            json.dumps([guild.id if guild else None, local], sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()

        try:
            async with asyncio.timeout(SYNC_TIMEOUT):
                remote = await self._remote_commands(guild)
                entry_points = [c for c in remote if c.get("type") == ENTRY_POINT_TYPE]
                remote_names = sorted(c["name"] for c in remote if c.get("type") != ENTRY_POINT_TYPE)
                if _read_text(SYNC_STAMP) == digest and remote_names == names:
                    # Набір не змінився і в Discord той самий — зайвий PUT не робимо (Discord обмежує частоту).
                    log.info(
                        "Slash-команди вже актуальні: %d %s — повторна синхронізація не потрібна", len(names), scope
                    )
                    return
                payload = local + [_entry_point_payload(c) for c in entry_points]
                assert self.application_id is not None
                if guild is None:
                    await self.http.bulk_upsert_global_commands(self.application_id, payload=payload)
                else:
                    await self.http.bulk_upsert_guild_commands(self.application_id, guild.id, payload=payload)
        except TimeoutError:
            log.warning(
                "Синхронізація slash-команд не вклалась у %d с (схоже, rate limit Discord). "
                "Бот працює далі, команди оновляться при наступному запуску.",
                SYNC_TIMEOUT,
            )
            return
        except discord.HTTPException as exc:
            log.error("Не вдалося синхронізувати slash-команди: %s. Перевір GUILD_ID і що бот є на сервері.", exc)
            return
        SYNC_STAMP.parent.mkdir(parents=True, exist_ok=True)
        SYNC_STAMP.write_text(digest, encoding="utf-8")
        kept = (
            f" (+ збережено Entry Point Activity: {', '.join(c['name'] for c in entry_points)})" if entry_points else ""
        )
        log.info("Синхронізовано %d slash-команд %s: %s%s", len(names), scope, " ".join(f"/{n}" for n in names), kept)
        if guild is None:
            log.info("Глобальні команди можуть з'явитися в клієнтах Discord не одразу (Ctrl+R у Discord прискорює)")

    async def _warmup(self) -> None:
        """Перший виклик yt-dlp повільний — прогріваємо, щоб автокомпліт встигав у 3 с."""
        try:
            await self.yt.search("lofi hip hop")
            log.info("yt-dlp прогрітий")
        except Exception as exc:
            log.warning("Прогрів yt-dlp не вдався: %s", exc)

    async def on_ready(self) -> None:
        assert self.user is not None
        log.info("Увійшов як %s (id %s), серверів: %d", self.user, self.user.id, len(self.guilds))
        invite = discord.utils.oauth_url(
            self.user.id, permissions=INVITE_PERMISSIONS, scopes=("bot", "applications.commands")
        )
        log.info("Запросити бота: %s", invite)
        if self.check_only:
            await self._sync_task
            await self._report_registered()
            await self.close()

    async def _report_registered(self) -> None:
        guild = discord.Object(id=self.settings.guild_id) if self.settings.guild_id else None
        remote = await self._remote_commands(guild)
        labels = sorted(
            f"{c['name']} (Entry Point)" if c.get("type") == ENTRY_POINT_TYPE else f"/{c['name']}" for c in remote
        )
        log.info("Перевірка: у Discord зареєстровано %d команд: %s", len(remote), " ".join(labels))

    async def _on_app_command_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.NoPrivateMessage):
            text = "Команда працює тільки на сервері."
        elif isinstance(error, app_commands.CheckFailure):
            text = "Ця команда тобі недоступна."
        else:
            command = interaction.command.qualified_name if interaction.command else "?"
            log.error("Помилка в /%s", command, exc_info=error)
            text = "Щось пішло не так 😵 Подробиці в logs/bot.log."
        await reply_error(interaction, text)

    async def close(self) -> None:
        await self.players.shutdown()
        await self.web.stop()
        await self.colors.close()
        self.yt.close()
        await super().close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Adolfik — музичний Discord-бот")
    parser.add_argument("--check", action="store_true", help="залогінитись, синхронізувати команди і вийти")
    args = parser.parse_args()

    setup_logging()
    settings = Settings.load()
    if problems := preflight(settings):
        for problem in problems:
            log.critical(problem)
        return 1

    bot = Adolfik(settings, check_only=args.check)
    try:
        bot.run(settings.token, log_handler=None)
    except discord.LoginFailure:
        log.critical("Discord відхилив DISCORD_TOKEN — перевір токен у .env.")
        return 1
    except discord.PrivilegedIntentsRequired:
        log.critical(
            "Увімкни Message Content Intent: https://discord.com/developers/applications -> твій бот -> Bot -> "
            "Privileged Gateway Intents -> Message Content Intent -> Save. Без нього музичний канал не бачить текст."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

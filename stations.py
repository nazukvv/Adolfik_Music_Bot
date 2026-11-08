"""Музичний канал: окремий текстовий канал з однією постійною панеллю.

Пишеш у канал назву пісні або посилання — бот вмикає, а повідомлення прибирає.
Налаштування зберігаються в data/stations.json: {guild_id: {channel_id, message_id}}.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

import discord

from config import BASE_DIR
from ui import panels
from ui.panels import NO_PINGS

if TYPE_CHECKING:
    from bot import Adolfik

log = logging.getLogger(__name__)

STATIONS_FILE = BASE_DIR / "data" / "stations.json"


@dataclass(slots=True)
class Station:
    channel_id: int
    message_id: int


def welcome(guild: discord.Guild, note: str | None = None) -> discord.ui.LayoutView:
    """Панель музичного каналу, коли нічого не грає (Components V2, див. ui/panels.py)."""
    return panels.welcome(guild, note)


class StationManager:
    def __init__(self, bot: Adolfik) -> None:
        self.bot = bot
        self._stations: dict[int, Station] = {}
        self._locks: dict[int, asyncio.Lock] = {}
        # id панелей, про які точно відомо, що вони вже в Components V2 (решту перевіряємо один раз).
        self._v2_messages: set[int] = set()
        self._load()

    # ---------- збереження ----------

    def _load(self) -> None:
        try:
            raw = json.loads(STATIONS_FILE.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except (OSError, ValueError) as exc:
            log.warning("Не вдалося прочитати %s: %s", STATIONS_FILE.name, exc)
            return
        for guild_id, data in raw.items():
            try:
                self._stations[int(guild_id)] = Station(int(data["channel_id"]), int(data["message_id"]))
            except (KeyError, TypeError, ValueError):
                continue

    def _save(self) -> None:
        STATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = {str(gid): asdict(st) for gid, st in self._stations.items()}
        STATIONS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")

    # ---------- доступ ----------

    def get(self, guild_id: int | None) -> Station | None:
        return self._stations.get(guild_id) if guild_id is not None else None

    def all(self) -> dict[int, Station]:
        return dict(self._stations)

    def channel(self, guild: discord.Guild) -> discord.TextChannel | None:
        station = self.get(guild.id)
        if station is None:
            return None
        channel = guild.get_channel(station.channel_id)
        return channel if isinstance(channel, discord.TextChannel) else None

    def is_station_channel(self, channel: discord.abc.GuildChannel | discord.Thread | None) -> bool:
        if channel is None or getattr(channel, "guild", None) is None:
            return False
        station = self.get(channel.guild.id)
        return station is not None and station.channel_id == channel.id

    def set(self, guild_id: int, channel_id: int, message_id: int) -> None:
        self._stations[guild_id] = Station(channel_id, message_id)
        self._save()

    def forget(self, guild_id: int) -> Station | None:
        station = self._stations.pop(guild_id, None)
        if station is not None:
            self._save()
        return station

    # ---------- панель ----------

    async def show(self, guild: discord.Guild, view: discord.ui.LayoutView) -> discord.Message | None:
        """Редагує панель музичного каналу; якщо її видалили — надсилає нову.

        Панелі, надіслані до переходу на Components V2, — звичайні embed-повідомлення. Таке повідомлення
        пробуємо перетворити редагуванням (прибравши embed); якщо Discord не дасть — надсилаємо нову панель.
        """
        async with self._locks.setdefault(guild.id, asyncio.Lock()):
            station = self.get(guild.id)
            channel = self.channel(guild)
            if station is None:
                return None
            if channel is None:
                log.warning("[%s] Музичний канал %s зник — вимикаю його", guild.name, station.channel_id)
                self.forget(guild.id)
                return None

            old_id: int | None = station.message_id
            legacy = False
            if old_id not in self._v2_messages:
                try:
                    current = await channel.fetch_message(old_id)
                except discord.NotFound:
                    old_id = None
                except discord.HTTPException as exc:
                    log.warning("[%s] Не вдалося прочитати панель музичного каналу: %s", guild.name, exc)
                    return None
                else:
                    legacy = not current.flags.components_v2

            if old_id is not None:
                extra = {"content": None, "embed": None} if legacy else {}
                try:
                    message = await channel.get_partial_message(old_id).edit(
                        view=view, allowed_mentions=NO_PINGS, **extra
                    )
                except discord.NotFound:
                    old_id = None
                except discord.HTTPException as exc:
                    if not legacy:
                        log.warning("[%s] Не вдалося оновити панель музичного каналу: %s", guild.name, exc)
                        return None
                    log.info(
                        "[%s] Discord не дав перетворити стару embed-панель на Components V2 (%s) — надсилаю нову",
                        guild.name,
                        exc,
                    )
                else:
                    if legacy:
                        log.info("[%s] Стару embed-панель музичного каналу перетворено на Components V2", guild.name)
                    self._v2_messages.add(message.id)
                    return message

            try:
                message = await channel.send(view=view, allowed_mentions=NO_PINGS)
            except discord.HTTPException as exc:
                log.warning("[%s] Не можу надіслати панель у музичний канал: %s", guild.name, exc)
                return None
            # Спершу запам'ятовуємо нову панель, потім прибираємо стару — тоді on_raw_message_delete
            # не сприйме видалення старої як «панель зникла».
            station.message_id = message.id
            self._v2_messages.add(message.id)
            self._save()
            if old_id is not None:
                with contextlib.suppress(discord.HTTPException):
                    await channel.get_partial_message(old_id).delete()
            return message

    async def show_welcome(self, guild: discord.Guild, note: str | None = None) -> discord.Message | None:
        return await self.show(guild, welcome(guild, note))

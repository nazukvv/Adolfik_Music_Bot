"""Музичний канал: окремий текстовий канал з однією постійною панеллю.

Пишеш у канал назву пісні або посилання — бот вмикає, а повідомлення прибирає.
Налаштування зберігаються в data/stations.json: {guild_id: {channel_id, message_id}}.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

import discord

from config import BASE_DIR
from ui import embeds

if TYPE_CHECKING:
    from bot import Adolfik

log = logging.getLogger(__name__)

STATIONS_FILE = BASE_DIR / "data" / "stations.json"


@dataclass(slots=True)
class Station:
    channel_id: int
    message_id: int


def welcome(guild: discord.Guild, note: str | None = None) -> discord.Embed:
    """Панель музичного каналу, коли нічого не грає."""
    embed = discord.Embed(color=embeds.accent())
    me = guild.me
    avatar = me.display_avatar.url if me else None
    embed.set_author(name="🎶  Музичний канал", icon_url=avatar)
    embed.title = "Напиши сюди назву пісні — і я її ввімкну"
    embed.description = (
        "1️⃣  Зайди в голосовий канал\n"
        "2️⃣  Напиши в цей чат назву пісні або кинь посилання YouTube\n"
        "3️⃣  Керуй музикою кнопками під панеллю\n\n"
        "Можна кидати посилання на цілий плейлист. Твоє повідомлення я одразу приберу, "
        "щоб у каналі була тільки панель ✨"
    )
    if avatar:
        embed.set_thumbnail(url=avatar)
    embed.set_footer(text=f"{embeds.BRAND} • {note}" if note else f"{embeds.BRAND} • чекаю на музику 🎧")
    return embed


class StationManager:
    def __init__(self, bot: Adolfik) -> None:
        self.bot = bot
        self._stations: dict[int, Station] = {}
        self._locks: dict[int, asyncio.Lock] = {}
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

    async def show(
        self, guild: discord.Guild, embed: discord.Embed, view: discord.ui.View | None
    ) -> discord.Message | None:
        """Редагує панель музичного каналу; якщо її видалили — надсилає нову."""
        async with self._locks.setdefault(guild.id, asyncio.Lock()):
            station = self.get(guild.id)
            channel = self.channel(guild)
            if station is None:
                return None
            if channel is None:
                log.warning("[%s] Музичний канал %s зник — вимикаю його", guild.name, station.channel_id)
                self.forget(guild.id)
                return None
            try:
                return await channel.get_partial_message(station.message_id).edit(embed=embed, view=view)
            except discord.NotFound:
                pass
            except discord.HTTPException as exc:
                log.warning("[%s] Не вдалося оновити панель музичного каналу: %s", guild.name, exc)
                return None
            try:
                message = await channel.send(embed=embed, view=view)
            except discord.HTTPException as exc:
                log.warning("[%s] Не можу надіслати панель у музичний канал: %s", guild.name, exc)
                return None
            station.message_id = message.id
            self._save()
            return message

    async def show_welcome(self, guild: discord.Guild, note: str | None = None) -> discord.Message | None:
        return await self.show(guild, welcome(guild, note), None)

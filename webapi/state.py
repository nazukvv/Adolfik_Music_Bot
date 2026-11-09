"""Стан плеєра у JSON для Activity: однаковий для всіх у каналі + «you» для конкретного користувача."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

import discord

from player import LoopMode

if TYPE_CHECKING:
    from bot import Adolfik
    from player import GuildPlayer
    from youtube import Track

LOOP_NAMES = {LoopMode.OFF: "off", LoopMode.TRACK: "track", LoopMode.QUEUE: "queue"}
LOOP_BY_NAME = {name: mode for mode, name in LOOP_NAMES.items()}
QUEUE_LIMIT = 200  # більше в JSON не шлемо (черга буває до 1000 треків)


def _avatar(member: discord.abc.User) -> str:
    return member.display_avatar.with_size(64).url


def user_json(guild: discord.Guild | None, user_id: int | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    member = guild.get_member(user_id) if guild else None
    if member is None:
        return {"id": str(user_id), "name": None, "avatar": None}
    return {"id": str(member.id), "name": member.display_name, "avatar": _avatar(member)}


def track_json(track: Track, guild: discord.Guild | None = None) -> dict[str, Any]:
    return {
        "id": track.id,
        # Унікальний ключ саме цього елемента черги (той самий трек може стояти двічі) — для drag-and-drop.
        "key": f"{id(track):x}",
        "title": track.title,
        "channel": track.channel,
        "duration": track.duration,
        "is_live": track.is_live,
        "url": track.url,
        "thumbnail": track.thumb_large,
        "thumbnail_small": track.thumb_small,
        "requester": user_json(guild, track.requester_id),
    }


def player_json(player: GuildPlayer | None) -> dict[str, Any] | None:
    if player is None:
        return None
    current = player.current
    return {
        "current": track_json(current, player.guild) if current else None,
        # трек вибрано, але звук ще не пішов (витягуємо стрім / чекаємо «передрол» YouTube)
        "preparing": current is not None and player.source is None,
        "paused": player.is_paused,
        "position": round(player.position, 2),
        "volume": player.volume,
        "loop": LOOP_NAMES[player.loop_mode],
        "queue": [track_json(t, player.guild) for t in player.queue[:QUEUE_LIMIT]],
        "queue_total": len(player.queue),
        "queue_duration": player.queue_duration,
        "color": f"#{player.color:06x}",
        "last_action": player.last_action,
        "can_seek": bool(current and not current.is_live and player.source is not None),
    }


def bot_channel(guild: discord.Guild) -> discord.VoiceChannel | discord.StageChannel | None:
    vc = guild.voice_client
    if isinstance(vc, discord.VoiceClient) and vc.is_connected():
        return vc.channel  # type: ignore[return-value]
    return None


def guild_state(bot: Adolfik, guild: discord.Guild) -> dict[str, Any]:
    """Загальний стан сервера — однаковий для всіх, хто відкрив Activity."""
    channel = bot_channel(guild)
    voice = None
    if channel is not None:
        listeners = sum(1 for m in channel.members if not m.bot)
        voice = {"id": str(channel.id), "name": channel.name, "listeners": listeners}
    return {
        "type": "state",
        "server_time": time.time(),
        "guild": {
            "id": str(guild.id),
            "name": guild.name,
            "icon": guild.icon.with_size(64).url if guild.icon else None,
        },
        "voice_channel": voice,
        "player": player_json(bot.players.get(guild.id)),
    }


def you_json(guild: discord.Guild, member: discord.Member) -> dict[str, Any]:
    """Права конкретного користувача: керувати можна лише з того ж войсу, що й бот."""
    channel = bot_channel(guild)
    user_channel = member.voice.channel if member.voice else None
    return {
        "id": str(member.id),
        "name": member.display_name,
        "avatar": _avatar(member),
        "voice_channel_id": str(user_channel.id) if user_channel else None,
        "can_control": channel is not None and user_channel == channel,
        "can_summon": channel is None and user_channel is not None,
    }

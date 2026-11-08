"""Усі embed-и бота в одному стилі."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from player import GuildPlayer
    from youtube import Track

BRAND = "Adolfik"
SUCCESS = 0x22C55E
ERROR = 0xEF4444
WARNING = 0xF59E0B
QUEUE_PAGE_SIZE = 10
BAR_LENGTH = 16

_accent = 0x8B5CF6


def configure(accent: int) -> None:
    global _accent
    _accent = accent


def accent() -> int:
    return _accent


# ---------- форматування ----------


def fmt_time(seconds: float | int | None) -> str:
    if seconds is None:
        return "—"
    total = max(0, int(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02}:{secs:02}" if hours else f"{minutes}:{secs:02}"


def track_length(track: Track) -> str:
    return "🔴 Наживо" if track.is_live else fmt_time(track.duration)


def clean(text: str | None, limit: int = 100) -> str:
    """Безпечний текст для markdown: без форматування і без квадратних дужок у посиланнях."""
    text = discord.utils.escape_markdown(text or "—").replace("[", "⁅").replace("]", "⁆")
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def link(track: Track, limit: int = 60) -> str:
    return f"[{clean(track.title, limit)}]({track.url})"


def progress_bar(position: float, duration: int | None) -> str:
    if not duration:
        return "▬" * (BAR_LENGTH // 2) + "🔴" + "▬" * (BAR_LENGTH // 2)
    ratio = max(0.0, min(1.0, position / duration))
    knob = min(BAR_LENGTH - 1, int(ratio * BAR_LENGTH))
    return "▬" * knob + "🔘" + "▬" * (BAR_LENGTH - knob - 1)


def volume_icon(volume: int) -> str:
    if volume == 0:
        return "🔇"
    return "🔉" if volume < 50 else "🔊"


def _base(*, color: int | None = None, footer: str | None = None) -> discord.Embed:
    embed = discord.Embed(color=_accent if color is None else color)
    embed.set_footer(text=f"{BRAND} • {footer}" if footer else BRAND)
    return embed


# ---------- прості відповіді ----------


def success(text: str, *, title: str | None = None) -> discord.Embed:
    embed = _base(color=SUCCESS)
    embed.description = f"✅ {text}" if title is None else text
    if title:
        embed.title = f"✅ {title}"
    return embed


def error(text: str) -> discord.Embed:
    embed = _base(color=ERROR)
    embed.description = f"❌ {text}"
    return embed


def info(text: str, *, emoji: str = "🎵", color: int | None = None) -> discord.Embed:
    embed = _base(color=color)
    embed.description = f"{emoji} {text}"
    return embed


def action(text: str, *, track: Track | None = None, color: int | None = None) -> discord.Embed:
    """Відповідь на дію з плеєром (skip, pause, …), опційно з мініатюрою треку."""
    embed = _base(color=color)
    embed.description = text
    if track:
        embed.set_thumbnail(url=track.thumb_small)
    return embed


# ---------- треки ----------


def track_added(track: Track, *, position: int, starting: bool, eta: int | None) -> discord.Embed:
    embed = _base()
    embed.set_author(name="▶️ Зараз заграє" if starting else "➕ Додано в чергу")
    embed.title = clean(track.title, 250)
    embed.url = track.url
    embed.set_thumbnail(url=track.thumb_small)
    embed.add_field(name="⏱ Тривалість", value=track_length(track))
    embed.add_field(name="👤 Канал", value=clean(track.channel, 60))
    if not starting:
        embed.add_field(name="📍 Позиція", value=f"#{position}")
        if eta is not None:
            embed.add_field(name="⏳ Заграє через", value=f"~{fmt_time(eta)}")
    if track.requester_id:
        embed.add_field(name="🙋 Замовив", value=f"<@{track.requester_id}>")
    return embed


def tracks_added(
    tracks: list[Track], *, position: int, starting: bool, title: str | None = None, url: str | None = None
) -> discord.Embed:
    """Плейлист або кілька треків з /search."""
    total = sum(t.duration or 0 for t in tracks)
    embed = _base()
    embed.set_author(name="📃 Плейлист додано" if title else "➕ Додано в чергу")
    if title:
        embed.title = clean(title, 250)
        embed.url = url
    preview = [f"`{i}.` {link(t, 55)} `{track_length(t)}`" for i, t in enumerate(tracks[:5], start=position)]
    if len(tracks) > 5:
        preview.append(f"… і ще **{len(tracks) - 5}**")
    embed.description = "\n".join(preview)
    embed.add_field(name="🎶 Треків", value=str(len(tracks)))
    embed.add_field(name="⏱ Загалом", value=fmt_time(total))
    embed.add_field(name="📍 Позиції", value="зараз заграє" if starting else f"з #{position}")
    embed.set_thumbnail(url=tracks[0].thumb_small)
    return embed


def track_failed(track: Track, reason: str) -> discord.Embed:
    embed = _base(color=WARNING, footer="Переходжу до наступного треку")
    embed.set_author(name="⚠️ Не вдалося відтворити")
    embed.description = f"{link(track)}\n{reason}"
    embed.set_thumbnail(url=track.thumb_small)
    return embed


# ---------- панель «Зараз грає» ----------


def now_playing(player: GuildPlayer) -> discord.Embed:
    track = player.current
    assert track is not None
    paused = player.is_paused
    position = player.position

    embed = discord.Embed(color=player.color, title=clean(track.title, 250), url=track.url)
    me = player.guild.me
    embed.set_author(name="⏸  На паузі" if paused else "🎶  Зараз грає", icon_url=me.display_avatar.url if me else None)

    state = "⏸️" if paused else "▶️"
    if track.is_live:
        embed.description = f"{state} {progress_bar(0, None)}\n🔴 **Пряма трансляція** • `{fmt_time(position)}`"
    else:
        embed.description = (
            f"{state} {progress_bar(position, track.duration)}\n`{fmt_time(position)} / {fmt_time(track.duration)}`"
        )

    embed.add_field(name="👤 Канал", value=clean(track.channel, 60))
    embed.add_field(name="🙋 Замовив", value=f"<@{track.requester_id}>" if track.requester_id else "—")
    embed.add_field(name=f"{volume_icon(player.volume)} Гучність", value=f"{player.volume}%")
    embed.add_field(name=f"{player.loop_mode.emoji} Повтор", value=player.loop_mode.label)
    queue_text = f"{len(player.queue)} • {fmt_time(player.queue_duration)}" if player.queue else "порожня"
    embed.add_field(name="📜 У черзі", value=queue_text)

    upcoming = player.upcoming()
    if upcoming is None:
        nxt = "Нічого — додай через **/play**"
    elif upcoming is track and player.loop_mode.value == 1:
        nxt = "🔂 Цей самий трек ще раз"
    else:
        nxt = f"{link(upcoming, 70)} `{track_length(upcoming)}`"
    embed.add_field(name="⏭ Далі", value=nxt, inline=False)

    embed.set_image(url=track.thumb_large)
    embed.set_footer(text=f"{BRAND} • {player.last_action or 'кнопки працюють для тих, хто у войсі'}")
    return embed


def idle(player: GuildPlayer) -> discord.Embed:
    embed = _base(footer=player.last_action or "вийду з каналу через 5 хв тиші")
    embed.set_author(name="💤  Черга закінчилась")
    embed.description = "Додай ще музики через **/play** або **/search** 🎧"
    return embed


def goodbye(reason: str | None) -> discord.Embed:
    embed = _base()
    embed.set_author(name="👋  Відключився")
    embed.description = reason or "Музику зупинено."
    return embed


# ---------- черга ----------


def queue_pages(player: GuildPlayer | None) -> int:
    if player is None:
        return 1
    return max(1, math.ceil(len(player.queue) / QUEUE_PAGE_SIZE))


def queue_page(player: GuildPlayer | None, page: int) -> discord.Embed:
    if player is None or (player.current is None and not player.queue):
        return info("Черга порожня. Додай щось через **/play** 🎧", emoji="📜")

    pages = queue_pages(player)
    page = max(0, min(page, pages - 1))
    embed = discord.Embed(color=player.color)
    embed.set_author(name=f"📜  Черга — {player.guild.name}")

    lines: list[str] = []
    if player.current:
        cur = player.current
        when = "🔴 наживо" if cur.is_live else f"{fmt_time(player.position)} / {fmt_time(cur.duration)}"
        lines += [f"**{'⏸' if player.is_paused else '▶️'} Зараз:** {link(cur, 60)} `{when}`", ""]

    start = page * QUEUE_PAGE_SIZE
    chunk = player.queue[start : start + QUEUE_PAGE_SIZE]
    for number, track in enumerate(chunk, start=start + 1):
        who = f" · <@{track.requester_id}>" if track.requester_id else ""
        lines.append(f"`{number:>2}.` {link(track, 55)} `{track_length(track)}`{who}")
    if not player.queue:
        lines.append("*Далі нічого нема.*")
    embed.description = "\n".join(lines)

    unknown = any(t.duration is None for t in player.queue)
    total = fmt_time(player.queue_duration) + ("+" if unknown else "")
    embed.set_footer(
        text=f"Сторінка {page + 1}/{pages} • {len(player.queue)} треків • {total} • "
        f"повтор: {player.loop_mode.label.lower()}"
    )
    if player.current:
        embed.set_thumbnail(url=player.current.thumb_small)
    return embed


# ---------- пошук ----------


def search_results(query: str, tracks: list[Track]) -> list[discord.Embed]:
    result: list[discord.Embed] = []
    for number, track in enumerate(tracks, start=1):
        embed = discord.Embed(color=_accent, title=f"{number}. {clean(track.title, 90)}", url=track.url)
        embed.description = f"👤 {clean(track.channel, 60)}\n⏱ {track_length(track)}"
        embed.set_thumbnail(url=track.thumb_small)
        result.append(embed)
    result[0].set_author(name=f"🔎  Результати пошуку: {query[:80]}")
    result[-1].set_footer(text=f"{BRAND} • вибери один або кілька треків у меню нижче ⬇️")
    return result

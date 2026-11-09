"""Slash-команди музики."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

import discord
from discord import app_commands
from discord.ext import commands

from player import MAX_VOLUME, GuildPlayer, LoopMode, spawn
from ui import embeds
from ui.checks import plural, reply_error, voice_problem
from ui.views import QueueView, SearchView
from youtube import Resolved, Track, YouTubeError, looks_like_url

if TYPE_CHECKING:
    from bot import Adolfik

log = logging.getLogger(__name__)

AUTOCOMPLETE_MIN_CHARS = 2
AUTOCOMPLETE_DEBOUNCE = 0.35  # пауза в наборі, після якої реально шукаємо
AUTOCOMPLETE_TIMEOUT = 2.1  # Discord чекає відповідь автокомпліту максимум 3 с


class JoinError(Exception):
    """Не вдалося підключитися або додати треки."""


@dataclass(slots=True)
class EnqueueResult:
    player: GuildPlayer
    tracks: list[Track]  # що реально додано (з requester_id)
    position: int  # позиція першого доданого в черзі (1 = наступний)
    starting: bool  # нічого не грало — перший трек заграє одразу
    embed: discord.Embed


def _choice_name(track: Track) -> str:
    suffix = f" • {embeds.track_length(track)}"
    title = track.title
    room = 100 - len(suffix)
    if len(title) > room:
        title = title[: room - 1].rstrip() + "…"
    return title + suffix


class Music(commands.Cog):
    def __init__(self, bot: Adolfik) -> None:
        self.bot = bot
        self._autocomplete_latest: dict[int, int] = {}

    # ---------- допоміжне ----------

    async def _controlled_player(self, interaction: discord.Interaction) -> GuildPlayer | None:
        """Плеєр, яким цей користувач має право керувати (сидить у тому ж войсі)."""
        problem = voice_problem(interaction)
        player = self.bot.players.get(interaction.guild_id)
        if problem is None and player is None:
            problem = "Зараз нічого не грає. Увімкни щось через /play 🎧"
        if problem:
            await reply_error(interaction, problem)
            return None
        return player

    def _join_problem(self, interaction: discord.Interaction) -> str | None:
        return self.join_problem(interaction.user, interaction.guild)

    def join_problem(self, member: discord.abc.User, guild: discord.Guild | None) -> str | None:
        """Чи може member зараз увімкнути музику (використовується і музичним каналом)."""
        if guild is None or not isinstance(member, discord.Member):
            return "Команда працює тільки на сервері."
        if member.voice is None or member.voice.channel is None:
            return "Спершу зайди в голосовий канал 🎧"
        channel = member.voice.channel
        vc = guild.voice_client
        if isinstance(vc, discord.VoiceClient) and vc.channel and vc.channel != channel:
            player = self.bot.players.get(guild.id)
            busy = player is not None and (player.current is not None or bool(player.queue))
            listeners = [m for m in vc.channel.members if not m.bot]
            if busy and listeners:
                return f"Я вже граю в {vc.channel.mention} — приєднуйся туди 🙂"
        perms = channel.permissions_for(guild.me)
        if not (perms.connect and perms.speak):
            return f"У мене нема прав **Connect** і **Speak** у {channel.mention}."
        if channel.user_limit and len(channel.members) >= channel.user_limit and not perms.move_members:
            return f"{channel.mention} заповнений."
        return None

    async def _enqueue(self, interaction: discord.Interaction, resolved: Resolved) -> discord.Embed:
        return await self.enqueue(interaction.user, interaction.channel, resolved)  # type: ignore[arg-type]

    async def enqueue(
        self, member: discord.abc.User, text_channel: discord.abc.Messageable, resolved: Resolved
    ) -> discord.Embed:
        """Підключитися до войсу автора і додати треки (використовується і музичним каналом)."""
        return (await self.enqueue_tracks(member, text_channel, resolved)).embed

    async def enqueue_tracks(
        self, member: discord.abc.User, text_channel: discord.abc.Messageable, resolved: Resolved
    ) -> EnqueueResult:
        """Те саме, що enqueue, але з подробицями (для Activity)."""
        assert isinstance(member, discord.Member) and member.voice and member.voice.channel
        tracks = [t.for_requester(member.id) for t in resolved.tracks]

        # Якщо зараз тиша — одразу витягуємо стрім першого трека, паралельно з підключенням до войсу.
        existing = self.bot.players.get(member.guild.id)
        warm: asyncio.Task | None = None
        if existing is None or (existing.current is None and not existing.queue):
            warm = asyncio.create_task(self.bot.yt.stream(tracks[0]))
            warm.add_done_callback(lambda t: t.cancelled() or t.exception())
        try:
            player = await self.bot.players.join(member.voice.channel, text_channel)  # type: ignore[arg-type]
        except TimeoutError as exc:
            if warm:
                warm.cancel()
            raise JoinError("Не вдалося підключитися до голосового каналу (таймаут). Спробуй ще раз.") from exc
        except (discord.ClientException, RuntimeError) as exc:
            if warm:
                warm.cancel()
            log.exception("Помилка підключення до войсу")
            raise JoinError(f"Не вдалося підключитися до войсу: {exc}") from exc

        starting = player.current is None and not player.queue
        position, added = player.add(tracks, warm=warm)
        if added == 0:
            raise JoinError("Черга переповнена (максимум 1000 треків).")
        tracks = tracks[:added]

        if resolved.playlist_title or len(tracks) > 1:
            embed = embeds.tracks_added(
                tracks, position=position, starting=starting, title=resolved.playlist_title, url=resolved.playlist_url
            )
        else:
            embed = embeds.track_added(tracks[0], position=position, starting=starting, eta=player.eta(position))
        if not starting:
            spawn(player.update_panel())  # оновити «у черзі» і «далі»
        return EnqueueResult(player=player, tracks=tracks, position=position, starting=starting, embed=embed)

    # ---------- /play ----------

    @app_commands.command(name="play", description="Увімкнути музику з YouTube: назва, посилання на відео або плейлист")
    @app_commands.rename(query="запит")
    @app_commands.describe(query="Почни друкувати назву — з'являться підказки. Або встав посилання YouTube")
    async def play(self, interaction: discord.Interaction, query: app_commands.Range[str, 1, 300]) -> None:
        if problem := self._join_problem(interaction):
            await reply_error(interaction, problem)
            return
        await interaction.response.defer(thinking=True)
        try:
            resolved = await self.bot.yt.resolve(query)
            embed = await self._enqueue(interaction, resolved)
        except (YouTubeError, JoinError) as exc:
            await reply_error(interaction, str(exc))
            return
        await interaction.followup.send(embed=embed)

    @play.autocomplete("query")
    async def play_autocomplete(self, interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
        query = current.strip()
        if looks_like_url(query):
            return [app_commands.Choice(name=f"🔗 {query}"[:100], value=query)] if len(query) <= 100 else []
        if len(query) < AUTOCOMPLETE_MIN_CHARS:
            return []

        tracks = self.bot.yt.cached_search(query)
        if tracks is None:
            # Дебаунс: Discord шле запит на кожну літеру. Шукаємо тільки коли користувач
            # зробив паузу; старі запити того ж користувача відкидаємо.
            user_id = interaction.user.id
            self._autocomplete_latest[user_id] = interaction.id
            await asyncio.sleep(AUTOCOMPLETE_DEBOUNCE)
            if self._autocomplete_latest.get(user_id) != interaction.id:
                return []
            try:
                tracks = await asyncio.wait_for(self.bot.yt.search(query), timeout=AUTOCOMPLETE_TIMEOUT)
            except (TimeoutError, YouTubeError):
                return []  # пошук доробиться у фоні й ляже в кеш для наступної літери
            finally:
                if self._autocomplete_latest.get(user_id) == interaction.id:
                    del self._autocomplete_latest[user_id]
        return [app_commands.Choice(name=_choice_name(t), value=t.url) for t in tracks[:10]]

    # ---------- /search ----------

    @app_commands.command(name="search", description="Знайти треки на YouTube і вибрати, що додати в чергу")
    @app_commands.rename(query="запит", count="кількість")
    @app_commands.describe(query="Що шукаємо", count="Скільки результатів показати (5–10)")
    async def search(
        self,
        interaction: discord.Interaction,
        query: app_commands.Range[str, 1, 200],
        count: app_commands.Range[int, 5, 10] = 8,
    ) -> None:
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            tracks = await self.bot.yt.search(query, limit=count)
        except YouTubeError as exc:
            await reply_error(interaction, str(exc))
            return
        if not tracks:
            await reply_error(interaction, f"Нічого не знайшов за запитом «{query[:80]}».")
            return
        view = SearchView(tracks, interaction.user.id, self._add_picked)
        view.interaction = interaction
        await interaction.followup.send(embeds=embeds.search_results(query, tracks), view=view, ephemeral=True)

    async def _add_picked(self, interaction: discord.Interaction, tracks: list[Track]) -> bool:
        if problem := self._join_problem(interaction):
            await reply_error(interaction, problem)
            return False
        await interaction.response.edit_message(embeds=[embeds.info("Додаю в чергу…", emoji="⏳")], view=None)
        try:
            embed = await self._enqueue(interaction, Resolved(tracks=list(tracks)))
        except JoinError as exc:
            await interaction.edit_original_response(embeds=[embeds.error(str(exc))])
            return True
        await interaction.edit_original_response(
            embeds=[embeds.success(f"Додано {plural(len(tracks), 'трек', 'треки', 'треків')} у чергу 🎶")]
        )
        await interaction.followup.send(embed=embed)
        return True

    # ---------- черга ----------

    @app_commands.command(name="queue", description="Показати чергу треків")
    @app_commands.rename(page="сторінка")
    @app_commands.describe(page="Номер сторінки")
    async def queue(self, interaction: discord.Interaction, page: app_commands.Range[int, 1, 100] = 1) -> None:
        await QueueView.send(interaction, ephemeral=False, page=page - 1)

    @app_commands.command(name="shuffle", description="Перемішати чергу")
    async def shuffle(self, interaction: discord.Interaction) -> None:
        if not (player := await self._controlled_player(interaction)):
            return
        if len(player.queue) < 2:
            await reply_error(interaction, "У черзі замало треків, щоб перемішувати.")
            return
        count = player.shuffle()
        player.last_action = f"🔀 {interaction.user.display_name} перемішав чергу"
        await interaction.response.send_message(
            embed=embeds.action(f"🔀 Перемішав {plural(count, 'трек', 'треки', 'треків')}")
        )
        await player.update_panel()

    @app_commands.command(name="remove", description="Прибрати трек із черги")
    @app_commands.rename(position="позиція")
    @app_commands.describe(position="Номер треку в черзі (див. /queue)")
    async def remove(self, interaction: discord.Interaction, position: app_commands.Range[int, 1, 1000]) -> None:
        if not (player := await self._controlled_player(interaction)):
            return
        track = player.remove(position)
        if track is None:
            await reply_error(interaction, f"У черзі нема позиції #{position}.")
            return
        player.last_action = f"🗑 {interaction.user.display_name} прибрав «{track.title[:40]}»"
        await interaction.response.send_message(
            embed=embeds.action(f"🗑 Прибрав із черги {embeds.link(track)}", track=track)
        )
        await player.update_panel()

    @remove.autocomplete("position")
    async def remove_autocomplete(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[int]]:
        player = self.bot.players.get(interaction.guild_id)
        if player is None:
            return []
        typed = str(current or "").strip()
        choices: list[app_commands.Choice[int]] = []
        for number, track in enumerate(player.queue, start=1):
            if typed and not str(number).startswith(typed):
                continue
            name = f"{number}. {track.title}"
            suffix = f" • {embeds.track_length(track)}"
            name = name[: 100 - len(suffix)] + suffix
            choices.append(app_commands.Choice(name=name, value=number))
            if len(choices) == 25:
                break
        return choices

    # ---------- керування відтворенням ----------

    @app_commands.command(name="skip", description="Пропустити поточний трек")
    async def skip(self, interaction: discord.Interaction) -> None:
        if not (player := await self._controlled_player(interaction)):
            return
        track = player.current
        if track is None or not player.skip():
            await reply_error(interaction, "Нема чого пропускати.")
            return
        player.last_action = f"⏭ {interaction.user.display_name} пропустив «{track.title[:40]}»"
        await interaction.response.send_message(embed=embeds.action(f"⏭ Пропустив {embeds.link(track)}", track=track))

    @app_commands.command(name="stop", description="Зупинити музику і очистити чергу")
    async def stop(self, interaction: discord.Interaction) -> None:
        if not (player := await self._controlled_player(interaction)):
            return
        player.last_action = f"⏹ {interaction.user.display_name} зупинив музику"
        player.stop()
        await interaction.response.send_message(embed=embeds.action("⏹ Музику зупинено, чергу очищено."))

    @app_commands.command(name="pause", description="Поставити на паузу")
    async def pause(self, interaction: discord.Interaction) -> None:
        if not (player := await self._controlled_player(interaction)):
            return
        if player.is_paused:
            await reply_error(interaction, "Вже на паузі. Продовжити — /resume")
            return
        if player.toggle_pause() is None:
            await reply_error(interaction, "Зараз нічого не грає.")
            return
        player.last_action = f"⏸ {interaction.user.display_name} поставив на паузу"
        await interaction.response.send_message(embed=embeds.action("⏸ Пауза. Продовжити — /resume або ⏯ на панелі."))
        await player.update_panel()

    @app_commands.command(name="resume", description="Продовжити відтворення")
    async def resume(self, interaction: discord.Interaction) -> None:
        if not (player := await self._controlled_player(interaction)):
            return
        if not player.is_paused:
            await reply_error(interaction, "Музика й так грає 🙂")
            return
        player.toggle_pause()
        player.last_action = f"▶️ {interaction.user.display_name} продовжив"
        await interaction.response.send_message(embed=embeds.action("▶️ Продовжую!"))
        await player.update_panel()

    @app_commands.command(name="volume", description="Змінити гучність (0–150%)")
    @app_commands.rename(level="рівень")
    @app_commands.describe(level="Гучність у відсотках; без значення — показати поточну")
    async def volume(
        self, interaction: discord.Interaction, level: Optional[app_commands.Range[int, 0, MAX_VOLUME]] = None
    ) -> None:
        if not (player := await self._controlled_player(interaction)):
            return
        if level is None:
            icon = embeds.volume_icon(player.volume)
            await interaction.response.send_message(
                embed=embeds.action(f"{icon} Гучність зараз: **{player.volume}%**"), ephemeral=True
            )
            return
        volume = player.set_volume(level)
        icon = embeds.volume_icon(volume)
        player.last_action = f"{icon} Гучність {volume}% — {interaction.user.display_name}"
        await interaction.response.send_message(embed=embeds.action(f"{icon} Гучність: **{volume}%**"))
        await player.update_panel()

    @app_commands.command(name="loop", description="Режим повтору: вимкнено / трек / вся черга")
    @app_commands.rename(mode="режим")
    @app_commands.describe(mode="Без значення — перемкнути на наступний режим")
    @app_commands.choices(
        mode=[
            app_commands.Choice(name="Вимкнути повтор", value=0),
            app_commands.Choice(name="Повторювати трек", value=1),
            app_commands.Choice(name="Повторювати всю чергу", value=2),
        ]
    )
    async def loop(self, interaction: discord.Interaction, mode: Optional[app_commands.Choice[int]] = None) -> None:
        if not (player := await self._controlled_player(interaction)):
            return
        new_mode = player.set_loop(LoopMode(mode.value)) if mode else player.cycle_loop()
        player.last_action = f"{new_mode.emoji} Повтор: {new_mode.label.lower()} — {interaction.user.display_name}"
        await interaction.response.send_message(embed=embeds.action(f"{new_mode.emoji} Повтор: **{new_mode.label}**"))
        await player.update_panel()

    @app_commands.command(name="nowplaying", description="Показати панель «Зараз грає» внизу чату")
    async def nowplaying(self, interaction: discord.Interaction) -> None:
        player = self.bot.players.get(interaction.guild_id)
        if player is None or player.current is None:
            await reply_error(interaction, "Зараз нічого не грає. Увімкни щось через /play 🎧")
            return
        if interaction.channel is not None:
            player.text_channel = interaction.channel  # type: ignore[assignment]
        await interaction.response.send_message(
            embed=embeds.info("Панель «Зараз грає» — нижче ⬇️", emoji="📌"), ephemeral=True
        )
        await player.update_panel(resend=True)

    @app_commands.command(name="leave", description="Вийти з голосового каналу")
    async def leave(self, interaction: discord.Interaction) -> None:
        if problem := voice_problem(interaction):
            await reply_error(interaction, problem)
            return
        await interaction.response.send_message(embed=embeds.action("👋 Виходжу з каналу. До зустрічі!"))
        await self.bot.players.destroy(
            interaction.guild_id or 0, f"{interaction.user.display_name} відключив мене. До зустрічі! 👋"
        )

    # ---------- події ----------

    @commands.Cog.listener()
    async def on_voice_state_update(
        self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState
    ) -> None:
        guild = member.guild
        if before.channel != after.channel:
            self.bot.players.notify(guild.id)  # Activity: хто в якому войсі = хто може керувати
        if self.bot.user and member.id == self.bot.user.id:
            if after.channel is None:
                await asyncio.sleep(2)  # дати discord.py шанс перепідключитися
                if guild.voice_client is None:
                    await self.bot.players.destroy(guild.id, "Мене відключили від голосового каналу.")
            elif (player := self.bot.players.get(guild.id)) is not None:
                player.on_voice_change()
            return

        player = self.bot.players.get(guild.id)
        if player is None or player.voice is None or before.channel == after.channel:
            return
        if player.voice.channel in (before.channel, after.channel):
            player.on_voice_change()

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        # Рахуємо повідомлення під панеллю: якщо її засипало — на новому треку перенесемо вниз.
        if message.guild is None:
            return
        player = self.bot.players.get(message.guild.id)
        if player and player.panel and message.channel.id == player.panel.channel.id and message.id != player.panel.id:
            player.messages_since_panel += 1


async def setup(bot: Adolfik) -> None:
    await bot.add_cog(Music(bot))

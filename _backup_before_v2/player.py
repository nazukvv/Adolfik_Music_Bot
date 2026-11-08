"""Черга і плеєр: окремий GuildPlayer на кожен сервер."""

from __future__ import annotations

import asyncio
import contextlib
import enum
import logging
import random
import time
from collections.abc import Coroutine
from typing import TYPE_CHECKING, Any

import discord

from ui import embeds
from ui.views import PlayerControls
from youtube import Stream, Track, YouTubeError

if TYPE_CHECKING:
    from bot import Adolfik

log = logging.getLogger(__name__)

ALONE_TIMEOUT = 120  # нікого в каналі
IDLE_TIMEOUT = 300  # черга порожня
PROGRESS_INTERVAL = 12  # як часто оновлювати прогрес-бар (rate limit!)
PREFETCH_DELAY = 2  # через скільки секунд після старту треку брати URL наступного
PREFETCH_BEFORE_END = 25  # для довгих треків: за скільки секунд до кінця
PREFETCH_MAX_AGE = 30 * 60  # старіші передзавантажені URL не використовуємо (живуть вони ~6 год)
PANEL_RESEND_AFTER = 4  # стільки нових повідомлень під панеллю — переносимо її вниз
ACTION_TTL = 90  # скільки секунд показувати «хто що натиснув» у футері
MAX_QUEUE = 1000
MAX_VOLUME = 150
FRAME_SECONDS = 0.02  # discord.py читає PCM кадрами по 20 мс

FFMPEG_BEFORE = "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -nostdin"
FFMPEG_OPTIONS = "-vn"

_background_tasks: set[asyncio.Task[None]] = set()


def spawn(coro: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
    """create_task, який тримає посилання на таск, щоб його не прибрав GC посеред роботи."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


class LoopMode(enum.IntEnum):
    OFF = 0
    TRACK = 1
    QUEUE = 2

    @property
    def label(self) -> str:
        return ("Вимкнено", "Трек", "Вся черга")[self]

    @property
    def emoji(self) -> str:
        return ("🔁", "🔂", "🔁")[self]

    def next(self) -> LoopMode:
        return LoopMode((self + 1) % 3)


class TrackedSource(discord.PCMVolumeTransformer[discord.FFmpegPCMAudio]):
    """PCM-джерело з гучністю, що рахує відтворені кадри — звідси точна позиція треку."""

    def __init__(self, original: discord.FFmpegPCMAudio, volume: float, start_at: float = 0.0) -> None:
        super().__init__(original, volume=volume)
        self.start_at = start_at
        self.frames = 0

    def read(self) -> bytes:
        data = super().read()
        if data:
            self.frames += 1
        return data

    @property
    def position(self) -> float:
        return self.start_at + self.frames * FRAME_SECONDS


class GuildPlayer:
    def __init__(self, bot: Adolfik, guild: discord.Guild, text_channel: discord.abc.Messageable) -> None:
        self.bot = bot
        self.guild = guild
        self.text_channel = text_channel

        self.queue: list[Track] = []
        self.current: Track | None = None
        self.source: TrackedSource | None = None
        self.loop_mode = LoopMode.OFF
        self.volume = bot.settings.default_volume
        self.color = bot.settings.embed_color

        self.panel: discord.Message | None = None
        self.messages_since_panel = 0
        self._last_action: tuple[str, float] | None = None

        self._loop = asyncio.get_running_loop()
        self._wake = asyncio.Event()
        self._track_end = asyncio.Event()
        self._interrupt = asyncio.Event()  # skip/stop, поки трек ще готується
        self._play_error: Exception | None = None
        self._skip = False
        self._stop = False
        self._auto_paused = False
        self.closing = False
        self._panel_lock = asyncio.Lock()

        self._prefetch: tuple[str, asyncio.Task[Stream]] | None = None
        self._prefetch_timer: asyncio.Task[None] | None = None
        self._alone_task: asyncio.Task[None] | None = None
        self._main_task = asyncio.create_task(self._run(), name=f"player-{guild.id}")
        self._progress_task = asyncio.create_task(self._progress_loop(), name=f"progress-{guild.id}")

    # ---------- стан ----------

    @property
    def voice(self) -> discord.VoiceClient | None:
        vc = self.guild.voice_client
        return vc if isinstance(vc, discord.VoiceClient) else None

    @property
    def is_paused(self) -> bool:
        vc = self.voice
        return bool(vc and vc.is_paused())

    @property
    def position(self) -> float:
        return self.source.position if self.source else 0.0

    @property
    def queue_duration(self) -> int:
        return sum(t.duration or 0 for t in self.queue)

    @property
    def last_action(self) -> str | None:
        if self._last_action and time.monotonic() - self._last_action[1] < ACTION_TTL:
            return self._last_action[0]
        return None

    @last_action.setter
    def last_action(self, text: str | None) -> None:
        self._last_action = (text, time.monotonic()) if text else None

    def upcoming(self) -> Track | None:
        """Що заграє після поточного треку з урахуванням режиму повтору."""
        if self.loop_mode is LoopMode.TRACK and self.current:
            return self.current
        if self.queue:
            return self.queue[0]
        if self.loop_mode is LoopMode.QUEUE:
            return self.current
        return None

    def eta(self, queue_position: int) -> int | None:
        """Через скільки секунд заграє трек на позиції queue_position (1 = наступний)."""
        total = 0.0
        if self.current:
            if not self.current.duration:
                return None
            total += max(0.0, self.current.duration - self.position)
        for track in self.queue[: queue_position - 1]:
            if not track.duration:
                return None
            total += track.duration
        return int(total)

    # ---------- керування ----------

    def add(self, tracks: list[Track], *, warm: asyncio.Task[Stream] | None = None) -> tuple[int, int]:
        """Додає треки в кінець черги. Повертає (позиція першого, скільки додано).

        warm — уже запущене витягування стріму для першого трека (паралельно з підключенням до войсу).
        """
        free = MAX_QUEUE - len(self.queue)
        tracks = tracks[: max(0, free)]
        position = len(self.queue) + 1
        if warm is not None:
            if tracks and self.current is None and not self.queue and self._prefetch is None:
                self._prefetch = (tracks[0].id, warm)
            else:
                warm.cancel()
        self.queue.extend(tracks)
        if tracks:
            self._wake.set()
            self._ensure_prefetch()
        return position, len(tracks)

    def toggle_pause(self) -> bool | None:
        """Повертає новий стан паузи або None, якщо нічого не грає."""
        vc = self.voice
        if vc is None:
            return None
        self._auto_paused = False
        if vc.is_paused():
            vc.resume()
            return False
        if vc.is_playing():
            vc.pause()
            return True
        return None

    def skip(self) -> bool:
        if self.current is None:
            return False
        self._skip = True
        self._interrupt.set()
        vc = self.voice
        if vc and (vc.is_playing() or vc.is_paused()):
            vc.stop()
        return True

    def stop(self) -> None:
        self.queue.clear()
        self._stop = True
        self._interrupt.set()
        self._cancel_prefetch()
        vc = self.voice
        if vc and (vc.is_playing() or vc.is_paused()):
            vc.stop()

    def set_volume(self, value: int) -> int:
        self.volume = max(0, min(MAX_VOLUME, value))
        if self.source:
            self.source.volume = self.volume / 100
        return self.volume

    def set_loop(self, mode: LoopMode) -> LoopMode:
        self.loop_mode = mode
        self._ensure_prefetch()
        return mode

    def cycle_loop(self) -> LoopMode:
        return self.set_loop(self.loop_mode.next())

    def shuffle(self) -> int:
        random.shuffle(self.queue)
        self._ensure_prefetch()
        return len(self.queue)

    def remove(self, position: int) -> Track | None:
        if 1 <= position <= len(self.queue):
            track = self.queue.pop(position - 1)
            self._ensure_prefetch()
            return track
        return None

    # ---------- головний цикл ----------

    async def _run(self) -> None:
        try:
            while not self.closing:
                if not self.queue:
                    self.current = None
                    self.source = None
                    await self._render_idle()
                    self._wake.clear()
                    try:
                        await asyncio.wait_for(self._wake.wait(), IDLE_TIMEOUT)
                    except TimeoutError:
                        await self.bot.players.destroy(self.guild.id, "Черга порожня вже 5 хвилин — виходжу 👋")
                        return
                    continue

                if not await self._wait_for_voice():
                    await self.bot.players.destroy(self.guild.id, "Втратив з'єднання з голосовим каналом 😕")
                    return

                track = self.queue.pop(0)
                self._skip = self._stop = False
                played = await self._play_track(track)
                if self._stop or self.closing or not played:
                    continue
                if self.loop_mode is LoopMode.TRACK and not self._skip:
                    self.queue.insert(0, track)
                elif self.loop_mode is LoopMode.QUEUE:
                    self.queue.append(track)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Плеєр сервера %s впав", self.guild.id)
            await self.bot.players.destroy(self.guild.id, "Внутрішня помилка плеєра 😵 Спробуй /play ще раз.")

    async def _wait_for_voice(self, timeout: int = 15) -> bool:
        """discord.py сам перепідключається до войсу; даємо йому трохи часу."""
        for _ in range(timeout):
            vc = self.voice
            if vc and vc.is_connected():
                return True
            await asyncio.sleep(1)
        return False

    async def _play_track(self, track: Track) -> bool:
        """Грає трек до кінця. Повертає False, якщо трек так і не вдалося відтворити."""
        self.current = track
        self.source = None
        self._interrupt.clear()
        color_task = asyncio.create_task(self.bot.colors.color_for(track.id, track.thumb_small))
        try:
            stream = await self._take_stream(track)
        except YouTubeError as exc:
            color_task.cancel()
            await self._report_error(track, str(exc))
            return False
        if self._skip or self._stop or self.closing:
            color_task.cancel()
            return False

        track.is_live = stream.is_live
        track.duration = stream.duration or track.duration
        track.thumbnail = track.thumbnail or stream.thumbnail

        start_at = 0.0
        retried = False
        source: TrackedSource | None = None
        while True:
            if not await self._wait_until_available(stream):
                color_task.cancel()
                return False
            if not retried:
                self.color = await color_task  # колір рахувався паралельно з очікуванням
            vc = self.voice
            if vc is None or not vc.is_connected():
                # Зв'язок з войсом пропав: повертаємо трек у чергу, _run дочекається перепідключення.
                log.warning("Нема голосового з'єднання на %s, відкладаю %s", self.guild.id, track.id)
                self.queue.insert(0, track)
                return False
            try:
                source = self._make_source(stream, start_at)
            except discord.ClientException as exc:
                await self._report_error(track, f"ffmpeg не запустився: {exc}")
                return False

            self._track_end.clear()
            self._play_error = None
            self.source = source
            try:
                vc.play(source, after=self._after_play, signal_type="music")
            except discord.ClientException as exc:
                source.cleanup()
                await self._report_error(track, f"Не вдалося почати відтворення: {exc}")
                return False
            if not retried:
                log.info("[%s] ▶ %s (%s)", self.guild.name, track.title, track.id)
                await self.update_panel(new_track=True)
                self._schedule_prefetch(track)

            await self._track_end.wait()
            if self._skip or self._stop or self.closing:
                return True

            position = source.position
            error = self._play_error
            ended_early = bool(not stream.is_live and track.duration and position < track.duration - 5)
            if (error or ended_early or source.frames == 0) and not retried:
                # Посилання протухло або обірвався стрім: один раз беремо свіже і продовжуємо з тієї ж секунди.
                retried = True
                log.warning("Стрім %s обірвався на %.1fс (%r) — перезапитую URL", track.id, position, error)
                try:
                    stream = await self.bot.yt.stream(track)
                except YouTubeError as exc:
                    await self._report_error(track, str(exc))
                    return source.frames > 0
                if self._skip or self._stop or self.closing:
                    return True
                start_at = 0.0 if stream.is_live else position
                continue

            if source.frames == 0:
                await self._report_error(track, "Стрім не віддає звук навіть після повторної спроби.")
                return False
            return True

    async def _wait_until_available(self, stream: Stream) -> bool:
        """Чекаємо, поки YouTube «відкриє» аудіо (див. Stream.available_at). False — якщо скіпнули."""
        delay = stream.wait_seconds()
        if delay <= 0:
            return not (self._skip or self._stop or self.closing)
        log.debug("Чекаю %.1fс, поки YouTube відкриє стрім", delay)
        try:
            await asyncio.wait_for(self._interrupt.wait(), timeout=delay + 0.3)
        except TimeoutError:
            pass
        return not (self._skip or self._stop or self.closing)

    def _make_source(self, stream: Stream, start_at: float) -> TrackedSource:
        before = FFMPEG_BEFORE
        if start_at >= 1:
            before = f"-ss {start_at:.2f} {before}"
        audio = discord.FFmpegPCMAudio(
            stream.url,
            executable=self.bot.settings.ffmpeg or "ffmpeg",
            before_options=before,
            options=FFMPEG_OPTIONS,
        )
        return TrackedSource(audio, volume=self.volume / 100, start_at=start_at)

    def _after_play(self, error: Exception | None) -> None:
        # Викликається з аудіо-потоку discord.py — повертаємось в event loop.
        self._loop.call_soon_threadsafe(self._on_play_end, error)

    def _on_play_end(self, error: Exception | None) -> None:
        if error:
            log.warning("Помилка відтворення на %s: %r", self.guild.id, error)
        self._play_error = error
        self._track_end.set()

    async def _report_error(self, track: Track, message: str) -> None:
        log.warning("[%s] Не вдалося відтворити %s: %s", self.guild.name, track.id, message)
        with contextlib.suppress(discord.HTTPException):
            await self.text_channel.send(embed=embeds.track_failed(track, message), delete_after=60)

    # ---------- передзавантаження URL наступного треку ----------

    def _schedule_prefetch(self, current: Track) -> None:
        if self._prefetch_timer:
            self._prefetch_timer.cancel()
        self._prefetch_timer = asyncio.create_task(self._prefetch_later(current))

    def _ensure_prefetch(self) -> None:
        """Черга змінилась — якщо «наступний» трек тепер інший, підтягнемо його URL заново."""
        if self.current is None or self.closing or self.source is None:
            return
        if self._prefetch_timer and not self._prefetch_timer.done():
            return  # таймер ще чекає і сам візьме актуальний «наступний»
        nxt = self.upcoming()
        if nxt is None or (self._prefetch and self._prefetch[0] == nxt.id):
            return
        self._prefetch_timer = asyncio.create_task(self._prefetch_later(self.current, delay=2))

    async def _prefetch_later(self, current: Track, delay: float = PREFETCH_DELAY) -> None:
        """URL наступного треку беремо заздалегідь, щоб не було тиші (YouTube ще й тримає ~5 с «передролу»).

        Звичайні треки — через кілька секунд після старту (тоді й skip майже миттєвий).
        Довгі — за ~25 с до кінця, щоб посилання не встигло постаріти.
        """
        duration = current.duration
        if duration and duration > PREFETCH_MAX_AGE - 60:
            while self.current is current:  # під час паузи позиція стоїть — це враховано
                remaining = duration - self.position
                if remaining <= PREFETCH_BEFORE_END:
                    break
                await asyncio.sleep(min(remaining - PREFETCH_BEFORE_END, 15))
        else:
            await asyncio.sleep(delay)
        nxt = self.upcoming()
        if self.current is not current or nxt is None or self.closing:
            return
        if self._prefetch and self._prefetch[0] == nxt.id:
            return
        self._cancel_prefetch()
        task = asyncio.create_task(self.bot.yt.stream(nxt))
        task.add_done_callback(lambda t: t.cancelled() or t.exception())  # без «exception never retrieved»
        self._prefetch = (nxt.id, task)
        log.debug("Передзавантажую стрім %s", nxt.id)

    def _cancel_prefetch(self) -> None:
        if self._prefetch:
            self._prefetch[1].cancel()
        self._prefetch = None

    async def _take_stream(self, track: Track) -> Stream:
        prefetched, self._prefetch = self._prefetch, None
        if prefetched:
            track_id, task = prefetched
            if track_id == track.id and not task.cancelled():
                try:
                    stream = await task
                    if time.monotonic() - stream.fetched_at < PREFETCH_MAX_AGE:
                        return stream
                except YouTubeError:
                    pass  # спробуємо ще раз нижче
            else:
                task.cancel()
        return await self.bot.yt.stream(track)

    # ---------- панель «Зараз грає» ----------

    async def update_panel(self, *, new_track: bool = False, resend: bool = False) -> None:
        if self.closing or self.current is None:
            return
        async with self._panel_lock:
            embed = embeds.now_playing(self)
            view = PlayerControls.for_player(self)
            if self.bot.stations.get(self.guild.id):
                # Є музичний канал — панель живе там, завжди одне й те саме повідомлення.
                message = await self.bot.stations.show(self.guild, embed, view)
                if message is not None:
                    self.panel = message
                    return
            panel = self.panel
            resend = (
                resend
                or panel is None
                or panel.channel.id != getattr(self.text_channel, "id", None)
                or (new_track and self.messages_since_panel >= PANEL_RESEND_AFTER)
            )
            if not resend and panel is not None:
                try:
                    await panel.edit(embed=embed, view=view)
                    return
                except discord.NotFound:
                    pass  # панель видалили — надішлемо нову
                except discord.HTTPException as exc:
                    log.warning("Не вдалося оновити панель на %s: %s", self.guild.id, exc)
                    return
            if panel is not None:
                with contextlib.suppress(discord.HTTPException):
                    await panel.delete()
            try:
                self.panel = await self.text_channel.send(embed=embed, view=view)
            except discord.HTTPException as exc:
                log.warning("Не можу надіслати панель на %s: %s", self.guild.id, exc)
                self.panel = None
                return
            self.messages_since_panel = 0

    async def _render_idle(self) -> None:
        if self.closing:
            return
        if self.bot.stations.get(self.guild.id):
            async with self._panel_lock:
                await self.bot.stations.show_welcome(self.guild, self.last_action or "черга закінчилась — напиши ще 🎧")
            return
        if self.panel is None:
            return
        async with self._panel_lock:
            with contextlib.suppress(discord.HTTPException):
                await self.panel.edit(embed=embeds.idle(self), view=None)

    async def _progress_loop(self) -> None:
        while not self.closing:
            await asyncio.sleep(PROGRESS_INTERVAL)
            try:
                vc = self.voice
                if self.current and self.source and vc and vc.is_playing():
                    await self.update_panel()
            except Exception:
                log.exception("Помилка оновлення прогресу на %s", self.guild.id)

    # ---------- автовихід ----------

    def on_voice_change(self) -> None:
        """Викликається, коли хтось зайшов/вийшов з каналу бота."""
        vc = self.voice
        if self.closing or vc is None or vc.channel is None:
            return
        listeners = [m for m in vc.channel.members if not m.bot]
        if listeners:
            if self._alone_task:
                self._alone_task.cancel()
                self._alone_task = None
            if self._auto_paused and vc.is_paused():
                vc.resume()
                self._auto_paused = False
                self.last_action = "▶️ Продовжую — у каналі знову є люди"
                spawn(self.update_panel())
        elif self._alone_task is None:
            if vc.is_playing():
                vc.pause()
                self._auto_paused = True
                self.last_action = "⏸ Пауза — у каналі нікого"
                spawn(self.update_panel())
            self._alone_task = asyncio.create_task(self._leave_when_alone())

    async def _leave_when_alone(self) -> None:
        await asyncio.sleep(ALONE_TIMEOUT)
        await self.bot.players.destroy(self.guild.id, "У каналі нікого вже 2 хвилини — виходжу 👋")

    async def close(self, reason: str | None) -> None:
        if self.closing:
            return
        self.closing = True
        me = asyncio.current_task()
        self._cancel_prefetch()
        for task in (self._main_task, self._progress_task, self._alone_task, self._prefetch_timer):
            if task and task is not me:
                task.cancel()
        self.queue.clear()
        vc = self.voice
        if vc:
            with contextlib.suppress(Exception):
                await vc.disconnect(force=True)
        if self.bot.stations.get(self.guild.id):
            self.current = None
            await self.bot.stations.show_welcome(self.guild, reason)
        elif self.panel:
            with contextlib.suppress(discord.HTTPException):
                await self.panel.edit(embed=embeds.goodbye(reason), view=None)
        self.current = None
        self.source = None


class PlayerManager:
    def __init__(self, bot: Adolfik) -> None:
        self.bot = bot
        self._players: dict[int, GuildPlayer] = {}
        self._locks: dict[int, asyncio.Lock] = {}

    def get(self, guild_id: int | None) -> GuildPlayer | None:
        if guild_id is None:
            return None
        player = self._players.get(guild_id)
        return player if player and not player.closing else None

    async def join(
        self,
        channel: discord.VoiceChannel | discord.StageChannel,
        text_channel: discord.abc.Messageable,
    ) -> GuildPlayer:
        guild = channel.guild
        station_channel = self.bot.stations.channel(guild)
        if station_channel is not None:
            text_channel = station_channel
        async with self._locks.setdefault(guild.id, asyncio.Lock()):
            vc = guild.voice_client
            if vc is None:
                await channel.connect(self_deaf=True, timeout=20, reconnect=True)
                log.info("[%s] Підключився до %s", guild.name, channel.name)
            elif isinstance(vc, discord.VoiceClient) and vc.channel != channel:
                await vc.move_to(channel)

            player = self.get(guild.id)
            if player is None:
                player = GuildPlayer(self.bot, guild, text_channel)
                self._players[guild.id] = player
            else:
                player.text_channel = text_channel
            player.on_voice_change()
            return player

    async def destroy(self, guild_id: int, reason: str | None = None) -> None:
        player = self._players.pop(guild_id, None)
        if player:
            log.info("[%s] Плеєр закрито: %s", player.guild.name, reason)
            await player.close(reason)
            return
        guild = self.bot.get_guild(guild_id)
        if guild and guild.voice_client:
            with contextlib.suppress(Exception):
                await guild.voice_client.disconnect(force=True)

    async def shutdown(self) -> None:
        for guild_id in list(self._players):
            await self.destroy(guild_id, "Бот вимикається. До зустрічі! 👋")

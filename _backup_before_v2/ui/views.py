"""Кнопки і меню: панель керування, пагінація черги, вибір результатів пошуку."""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

import discord

from ui import embeds
from ui.checks import reply_error, voice_problem

if TYPE_CHECKING:
    from player import GuildPlayer
    from youtube import Track

log = logging.getLogger(__name__)

VOLUME_STEP = 10
_PREFIX = "adolfik:"


def _player(interaction: discord.Interaction) -> GuildPlayer | None:
    players = getattr(interaction.client, "players", None)
    return players.get(interaction.guild_id) if players else None


def _name(interaction: discord.Interaction) -> str:
    return interaction.user.display_name


class PlayerControls(discord.ui.View):
    """Кнопки під панеллю «Зараз грає».

    Persistent: timeout=None і фіксовані custom_id, а сам view реєструється в setup_hook,
    тому кнопки на старих панелях відповідають і після перезапуску бота.
    """

    def __init__(self, *, paused: bool = False, loop_mode: int = 0) -> None:
        super().__init__(timeout=None)
        self.btn_pause.emoji = "▶️" if paused else "⏸️"
        self.btn_pause.style = discord.ButtonStyle.success if paused else discord.ButtonStyle.secondary
        self.btn_loop.emoji = "🔂" if loop_mode == 1 else "🔁"
        self.btn_loop.style = discord.ButtonStyle.success if loop_mode else discord.ButtonStyle.secondary

    @classmethod
    def for_player(cls, player: GuildPlayer) -> PlayerControls:
        return cls(paused=player.is_paused, loop_mode=int(player.loop_mode))

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        custom_id = (interaction.data or {}).get("custom_id")
        if custom_id == f"{_PREFIX}queue":
            return True  # переглядати чергу може будь-хто
        problem = voice_problem(interaction)
        if problem is None and _player(interaction) is None:
            problem = "Зараз нічого не грає. Увімкни щось через /play 🎧"
        if problem:
            await reply_error(interaction, problem)
            return False
        return True

    async def on_error(self, interaction: discord.Interaction, error: Exception, item: discord.ui.Item[Any]) -> None:
        log.exception("Помилка кнопки %s", getattr(item, "custom_id", item), exc_info=error)
        await reply_error(interaction, "Щось пішло не так 😵 Спробуй ще раз.")

    async def _apply_click(self, interaction: discord.Interaction, player: GuildPlayer, note: str) -> None:
        """Оновити панель прямо у відповіді на натискання (без зайвих повідомлень)."""
        player.last_action = note
        message = interaction.message
        if player.current and player.panel and message and message.id == player.panel.id:
            await interaction.response.edit_message(
                embed=embeds.now_playing(player), view=PlayerControls.for_player(player)
            )
            return
        # Натиснули на стару панель — відповідаємо приватно, а актуальну панель оновлюємо.
        await interaction.response.send_message(embed=embeds.action(note), ephemeral=True)
        await player.update_panel()

    # ----- ряд 1 -----

    @discord.ui.button(emoji="⏯️", style=discord.ButtonStyle.secondary, custom_id=f"{_PREFIX}pause", row=0)
    async def btn_pause(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        player = _player(interaction)
        assert player is not None
        paused = player.toggle_pause()
        if paused is None:
            await reply_error(interaction, "Зараз нічого не грає.")
            return
        note = f"⏸ {_name(interaction)} поставив на паузу" if paused else f"▶️ {_name(interaction)} продовжив"
        await self._apply_click(interaction, player, note)

    @discord.ui.button(emoji="⏭️", style=discord.ButtonStyle.primary, custom_id=f"{_PREFIX}skip", row=0)
    async def btn_skip(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        player = _player(interaction)
        assert player is not None
        track = player.current
        if track is None or not player.skip():
            await reply_error(interaction, "Нема чого пропускати.")
            return
        player.last_action = f"⏭ {_name(interaction)} пропустив «{track.title[:40]}»"
        await interaction.response.defer()  # панель сама оновиться, коли заграє наступний трек

    @discord.ui.button(emoji="⏹️", style=discord.ButtonStyle.danger, custom_id=f"{_PREFIX}stop", row=0)
    async def btn_stop(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        player = _player(interaction)
        assert player is not None
        player.last_action = f"⏹ {_name(interaction)} зупинив музику"
        player.stop()
        await interaction.response.defer()

    @discord.ui.button(emoji="🔁", style=discord.ButtonStyle.secondary, custom_id=f"{_PREFIX}loop", row=0)
    async def btn_loop(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        player = _player(interaction)
        assert player is not None
        mode = player.cycle_loop()
        await self._apply_click(interaction, player, f"{mode.emoji} Повтор: {mode.label.lower()} — {_name(interaction)}")

    @discord.ui.button(emoji="🔀", style=discord.ButtonStyle.secondary, custom_id=f"{_PREFIX}shuffle", row=0)
    async def btn_shuffle(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        player = _player(interaction)
        assert player is not None
        if len(player.queue) < 2:
            await reply_error(interaction, "У черзі замало треків, щоб перемішувати.")
            return
        player.shuffle()
        await self._apply_click(interaction, player, f"🔀 {_name(interaction)} перемішав чергу")

    # ----- ряд 2 -----

    @discord.ui.button(emoji="🔉", style=discord.ButtonStyle.secondary, custom_id=f"{_PREFIX}voldown", row=1)
    async def btn_vol_down(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        player = _player(interaction)
        assert player is not None
        volume = player.set_volume(player.volume - VOLUME_STEP)
        await self._apply_click(
            interaction, player, f"{embeds.volume_icon(volume)} Гучність {volume}% — {_name(interaction)}"
        )

    @discord.ui.button(emoji="🔊", style=discord.ButtonStyle.secondary, custom_id=f"{_PREFIX}volup", row=1)
    async def btn_vol_up(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        player = _player(interaction)
        assert player is not None
        volume = player.set_volume(player.volume + VOLUME_STEP)
        await self._apply_click(
            interaction, player, f"{embeds.volume_icon(volume)} Гучність {volume}% — {_name(interaction)}"
        )

    @discord.ui.button(
        emoji="📜", label="Черга", style=discord.ButtonStyle.secondary, custom_id=f"{_PREFIX}queue", row=1
    )
    async def btn_queue(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        await QueueView.send(interaction, ephemeral=True)


class QueueView(discord.ui.View):
    """Черга з пагінацією по 10 треків."""

    def __init__(self, client: discord.Client, guild_id: int | None, owner_id: int, page: int = 0) -> None:
        super().__init__(timeout=180)
        self.client = client
        self.guild_id = guild_id
        self.owner_id = owner_id
        self.page = page
        self.interaction: discord.Interaction | None = None
        self._sync()

    @classmethod
    async def send(cls, interaction: discord.Interaction, *, ephemeral: bool, page: int = 0) -> None:
        view = cls(interaction.client, interaction.guild_id, interaction.user.id, page)
        view.interaction = interaction
        await interaction.response.send_message(embed=view.render(), view=view, ephemeral=ephemeral)

    @property
    def player(self) -> GuildPlayer | None:
        players = getattr(self.client, "players", None)
        return players.get(self.guild_id) if players else None

    def render(self) -> discord.Embed:
        return embeds.queue_page(self.player, self.page)

    def _sync(self) -> None:
        pages = embeds.queue_pages(self.player)
        self.page = max(0, min(self.page, pages - 1))
        self.btn_first.disabled = self.btn_prev.disabled = self.page == 0
        self.btn_next.disabled = self.btn_last.disabled = self.page >= pages - 1
        self.btn_counter.label = f"{self.page + 1}/{pages}"

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await reply_error(interaction, "Це чужий список — відкрий свій через /queue 🙂")
            return False
        return True

    async def on_timeout(self) -> None:
        for item in self.children:
            if isinstance(item, discord.ui.Button):
                item.disabled = True
        if self.interaction:
            with contextlib.suppress(discord.HTTPException):
                await self.interaction.edit_original_response(view=self)

    async def _turn(self, interaction: discord.Interaction, page: int) -> None:
        self.page = page
        self._sync()
        await interaction.response.edit_message(embed=self.render(), view=self)

    @discord.ui.button(emoji="⏮️", style=discord.ButtonStyle.secondary)
    async def btn_first(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        await self._turn(interaction, 0)

    @discord.ui.button(emoji="◀️", style=discord.ButtonStyle.primary)
    async def btn_prev(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        await self._turn(interaction, self.page - 1)

    @discord.ui.button(label="1/1", style=discord.ButtonStyle.secondary, disabled=True)
    async def btn_counter(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        pass

    @discord.ui.button(emoji="▶️", style=discord.ButtonStyle.primary)
    async def btn_next(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        await self._turn(interaction, self.page + 1)

    @discord.ui.button(emoji="⏭️", style=discord.ButtonStyle.secondary)
    async def btn_last(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        await self._turn(interaction, embeds.queue_pages(self.player) - 1)


PickCallback = Callable[[discord.Interaction, list["Track"]], Awaitable[bool]]


class SearchView(discord.ui.View):
    """Select-меню з результатами /search (можна вибрати кілька треків)."""

    def __init__(self, tracks: list[Track], owner_id: int, on_pick: PickCallback) -> None:
        super().__init__(timeout=180)
        self.tracks = tracks
        self.owner_id = owner_id
        self.on_pick = on_pick
        self.interaction: discord.Interaction | None = None

        options = [
            discord.SelectOption(
                label=_cut(f"{i}. {t.title}", 100),
                description=_cut(f"{t.channel or '—'} • {embeds.track_length(t)}", 100),
                value=str(i - 1),
                emoji="🎵",
            )
            for i, t in enumerate(tracks, start=1)
        ]
        self.select: discord.ui.Select[SearchView] = discord.ui.Select(
            placeholder="🎵 Вибери треки (можна кілька)…",
            min_values=1,
            max_values=len(options),
            options=options,
            row=0,
        )
        self.select.callback = self._picked
        self.add_item(self.select)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await reply_error(interaction, "Це не твій пошук — запусти свій через /search 🙂")
            return False
        return True

    async def _picked(self, interaction: discord.Interaction) -> None:
        picked = [self.tracks[int(v)] for v in sorted(self.select.values, key=int)]
        if await self.on_pick(interaction, picked):
            self.stop()

    @discord.ui.button(label="Скасувати", emoji="✖️", style=discord.ButtonStyle.secondary, row=1)
    async def btn_cancel(self, interaction: discord.Interaction, button: discord.ui.Button[Any]) -> None:
        self.stop()
        await interaction.response.edit_message(embeds=[embeds.info("Пошук скасовано.", emoji="✖️")], view=None)

    async def on_timeout(self) -> None:
        for item in self.children:
            if isinstance(item, (discord.ui.Button, discord.ui.Select)):
                item.disabled = True
        if self.interaction:
            with contextlib.suppress(discord.HTTPException):
                await self.interaction.edit_original_response(view=self)


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"

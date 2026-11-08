"""Кнопки і меню: пагінація черги, вибір результатів пошуку. Панель «Зараз грає» — у ui/panels.py."""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

import discord

from ui import embeds
from ui.checks import reply_error

if TYPE_CHECKING:
    from player import GuildPlayer
    from youtube import Track

log = logging.getLogger(__name__)

_PREFIX = "adolfik:"


class LegacyPanelButtons(discord.ui.View):
    """Сумісність зі старими embed-панелями, що ще лишились у чатах.

    Їхні кнопки ⏯ ⏭ ⏹ 🔁 🔀 🔉 🔊 мають ті самі custom_id, що й нова панель (ui/panels.py), тож їх
    обробляє вона. Кнопки «📜 Черга» в новій панелі нема — її обробляємо тут, щоб не було «Interaction failed».
    """

    def __init__(self) -> None:
        super().__init__(timeout=None)

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

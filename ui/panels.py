"""Панелі на Components V2 (discord.ui.LayoutView): «Зараз грає», музичний канал, «черга закінчилась», «відключився».

Повідомлення з LayoutView не може мати content/embeds, тому всі тексти — у TextDisplay всередині Container.
Ліміти Discord: до 40 компонентів на повідомлення (тут ~24), до 4000 символів тексту, select — до 25 опцій.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import discord

from ui import embeds
from ui.checks import reply_error, voice_problem
from ui.embeds import clean, fmt_time, link, progress_bar, track_length, volume_icon

if TYPE_CHECKING:
    from player import GuildPlayer

log = logging.getLogger(__name__)

PREFIX = "adolfik:"
VOLUME_STEP = 10
MAX_VOLUME = 150
QUEUE_OPTIONS = 25  # максимум опцій у select-меню
# У V2 текст живе в TextDisplay і поводиться як content: згадки <@id> пінгували б людей. Вимикаємо.
NO_PINGS = discord.AllowedMentions.none()


def legacy_edit_kwargs(message: Any) -> dict[str, Any]:
    """Аргументи для edit(), коли повідомлення ще старе (embed): при переході на V2 embed і content треба прибрати."""
    flags = getattr(message, "flags", None)
    if flags is not None and flags.components_v2:
        return {}
    return {"content": None, "embed": None}


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _note(text: str | None, fallback: str) -> discord.ui.TextDisplay:
    """Маленький підпис унизу картки."""
    body = discord.utils.escape_markdown(_cut(text, 300)) if text else fallback
    return discord.ui.TextDisplay(f"-# {embeds.BRAND} · {body}")


def _player(interaction: discord.Interaction) -> GuildPlayer | None:
    players = getattr(interaction.client, "players", None)
    return players.get(interaction.guild_id) if players else None


def _name(interaction: discord.Interaction) -> str:
    return interaction.user.display_name


class Card(discord.ui.LayoutView):
    """Картка без кнопок: один Container."""

    def __init__(self, container: discord.ui.Container[Any]) -> None:
        super().__init__(timeout=None)
        self.add_item(container)


# ---------- статичні картки ----------


def welcome(guild: discord.Guild, note: str | None = None) -> Card:
    """Панель музичного каналу, коли нічого не грає."""
    me = guild.me
    avatar = me.display_avatar.url if me else None
    heading = discord.ui.TextDisplay("## 🎶 Музичний канал\nНапиши сюди назву пісні — і я її ввімкну")
    container = discord.ui.Container(accent_colour=embeds.accent())
    container.add_item(discord.ui.Section(heading, accessory=discord.ui.Thumbnail(avatar)) if avatar else heading)
    container.add_item(discord.ui.Separator())
    container.add_item(
        discord.ui.TextDisplay(
            "**Як користуватись**\n"
            "1️⃣  Зайди в голосовий канал\n"
            "2️⃣  Напиши в цей чат назву пісні або кинь посилання YouTube\n"
            "3️⃣  Керуй музикою кнопками на панелі"
        )
    )
    container.add_item(
        discord.ui.TextDisplay(
            "Можна кидати посилання на цілий плейлист. Твоє повідомлення я одразу приберу, "
            "щоб у каналі була тільки панель ✨"
        )
    )
    container.add_item(discord.ui.Separator())
    container.add_item(_note(note, "чекаю на музику 🎧"))
    return Card(container)


def idle(player: GuildPlayer) -> Card:
    """Звичайний режим: черга закінчилась, бот ще в каналі."""
    container = discord.ui.Container(accent_colour=player.color)
    container.add_item(
        discord.ui.TextDisplay("## 💤 Черга закінчилась\nДодай ще музики через **/play** або **/search** 🎧")
    )
    container.add_item(discord.ui.Separator())
    container.add_item(_note(player.last_action, "вийду з каналу через 5 хв тиші"))
    return Card(container)


def goodbye(reason: str | None) -> Card:
    """Бот вийшов із войсу."""
    container = discord.ui.Container(accent_colour=embeds.accent())
    text = discord.utils.escape_markdown(_cut(reason, 500)) if reason else "Музику зупинено."
    container.add_item(discord.ui.TextDisplay(f"## 👋 Відключився\n{text}"))
    container.add_item(discord.ui.Separator())
    container.add_item(_note(None, "напиши /play — і я повернусь"))
    return Card(container)


# ---------- «Зараз грає» ----------


class NowPlayingPanel(discord.ui.LayoutView):
    """Панель «Зараз грає» — картка з обкладинкою, прогресом і кнопками.

    Persistent: timeout=None і фіксовані custom_id з префіксом «adolfik:». Порожній екземпляр
    реєструється в setup_hook через bot.add_view(), тому кнопки й меню черги відповідають
    і на панелях, надісланих до перезапуску бота.
    """

    def __init__(self, player: GuildPlayer | None = None) -> None:
        super().__init__(timeout=None)
        self.add_item(self._build(player))

    # ----- побудова -----

    def _button(
        self,
        key: str,
        callback: Any,
        *,
        emoji: str,
        style: discord.ButtonStyle = discord.ButtonStyle.secondary,
        label: str | None = None,
        disabled: bool = False,
    ) -> discord.ui.Button[Any]:
        button: discord.ui.Button[Any] = discord.ui.Button(
            emoji=emoji, label=label, style=style, custom_id=PREFIX + key, disabled=disabled
        )
        button.callback = callback
        return button

    def _build(self, player: GuildPlayer | None) -> discord.ui.Container[Any]:
        track = player.current if player else None
        paused = bool(player and player.is_paused)
        loop_mode = int(player.loop_mode) if player else 0
        volume = player.volume if player else 50
        queue = player.queue if player else []

        container: discord.ui.Container[Any] = discord.ui.Container(
            accent_colour=player.color if player else embeds.accent()
        )
        container.add_item(discord.ui.TextDisplay("-# ⏸  НА ПАУЗІ" if paused else "-# 🎶  ЗАРАЗ ГРАЄ"))
        if track:
            container.add_item(discord.ui.MediaGallery(discord.MediaGalleryItem(track.thumb_large)))

        # Назва + канал + хто замовив, праворуч — ⏯
        title = f"### {link(track, 150)}" if track else "### Зараз нічого не грає"
        meta = [f"👤 {clean(track.channel, 60)}"] if track else ["Увімкни щось через **/play**"]
        if track and track.requester_id:
            meta.append(f"🙋 <@{track.requester_id}>")
        pause = self._button(
            "pause",
            self.cb_pause,
            emoji="▶️" if paused else "⏸️",
            label="Грати" if paused else "Пауза",
            style=discord.ButtonStyle.success if paused else discord.ButtonStyle.secondary,
        )
        container.add_item(
            discord.ui.Section(
                discord.ui.TextDisplay(title), discord.ui.TextDisplay("  ·  ".join(meta)), accessory=pause
            )
        )
        container.add_item(discord.ui.Separator())
        container.add_item(discord.ui.TextDisplay(self._status_text(player)))
        container.add_item(discord.ui.Separator())

        # Кнопки
        loop_emoji = "🔂" if loop_mode == 1 else "🔁"
        container.add_item(
            discord.ui.ActionRow(
                self._button("restart", self.cb_restart, emoji="⏮️", disabled=bool(track and track.is_live)),
                self._button("skip", self.cb_skip, emoji="⏭️", style=discord.ButtonStyle.primary),
                self._button("stop", self.cb_stop, emoji="⏹️", style=discord.ButtonStyle.danger),
                self._button(
                    "loop",
                    self.cb_loop,
                    emoji=loop_emoji,
                    style=discord.ButtonStyle.success if loop_mode else discord.ButtonStyle.secondary,
                ),
                self._button("shuffle", self.cb_shuffle, emoji="🔀", disabled=bool(player) and len(queue) < 2),
            )
        )
        container.add_item(
            discord.ui.ActionRow(
                self._button("voldown", self.cb_vol_down, emoji="🔉", disabled=bool(player) and volume <= 0),
                # Лише показує гучність; custom_id потрібен, бо persistent-view вимагає його для всіх кнопок.
                self._button("volume", self.cb_noop, emoji=volume_icon(volume), label=f"{volume}%", disabled=True),
                self._button("volup", self.cb_vol_up, emoji="🔊", disabled=bool(player) and volume >= MAX_VOLUME),
            )
        )
        container.add_item(discord.ui.ActionRow(self._queue_select(queue)))

        container.add_item(discord.ui.Separator(visible=False))
        container.add_item(_note(player.last_action if player else None, "керувати можуть ті, хто у войсі з ботом"))
        return container

    @staticmethod
    def _status_text(player: GuildPlayer | None) -> str:
        if player is None or player.current is None:
            return "▶️ " + progress_bar(0, 1)
        track = player.current
        position = player.position
        state = "⏸️" if player.is_paused else "▶️"
        if track.is_live:
            lines = [f"{state} {progress_bar(0, None)}  🔴 **Наживо** · `{fmt_time(position)}`"]
        else:
            lines = [
                f"{state} {progress_bar(position, track.duration)}  `{fmt_time(position)} / {fmt_time(track.duration)}`"
            ]

        mode = player.loop_mode
        queue_info = f"{len(player.queue)} • {fmt_time(player.queue_duration)}" if player.queue else "порожня"
        lines.append(
            f"{volume_icon(player.volume)} {player.volume}%  ·  {mode.emoji} Повтор: {mode.label.lower()}"
            f"  ·  📜 У черзі: {queue_info}"
        )

        upcoming = player.upcoming()
        if upcoming is None:
            lines.append("⏭ Далі: нічого — додай через **/play**")
        elif upcoming is track and mode.value == 1:
            lines.append("⏭ Далі: 🔂 цей самий трек ще раз")
        else:
            lines.append(f"⏭ Далі: {link(upcoming, 70)} `{track_length(upcoming)}`")
        return "\n".join(lines)

    def _queue_select(self, queue: list[Any]) -> discord.ui.Select[Any]:
        if queue:
            options = [
                discord.SelectOption(
                    label=_cut(f"{number}. {t.title}", 100),
                    description=_cut(f"{track_length(t)} · {t.channel or '—'}", 100),
                    # Позиція + id: якщо черга зміниться, поки меню відкрите, трек знайдемо за id.
                    value=f"{number}:{t.id}",
                    emoji="🎵",
                )
                for number, t in enumerate(queue[:QUEUE_OPTIONS], start=1)
            ]
            more = f" (ще {len(queue) - QUEUE_OPTIONS} нижче)" if len(queue) > QUEUE_OPTIONS else ""
            placeholder = _cut(f"📜 Далі в черзі: {len(queue)} — вибери, щоб перейти{more}", 150)
            disabled = False
        else:
            options = [discord.SelectOption(label="Черга порожня", value="empty")]
            placeholder = "Черга порожня"
            disabled = True
        select: discord.ui.Select[Any] = discord.ui.Select(
            custom_id=PREFIX + "jump", placeholder=placeholder, options=options, disabled=disabled
        )
        select.callback = self.cb_jump
        return select

    # ----- доступ і помилки -----

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        problem = voice_problem(interaction)
        if problem is None and _player(interaction) is None:
            problem = "Зараз нічого не грає. Увімкни щось через /play 🎧"
        if problem:
            await reply_error(interaction, problem)
            return False
        return True

    async def on_error(self, interaction: discord.Interaction, error: Exception, item: discord.ui.Item[Any]) -> None:
        log.exception("Помилка на панелі (%s)", getattr(item, "custom_id", item), exc_info=error)
        await reply_error(interaction, "Щось пішло не так 😵 Спробуй ще раз.")

    async def show_result(self, interaction: discord.Interaction, player: GuildPlayer, note: str) -> None:
        """Оновити панель прямо у відповіді на натискання (без нових повідомлень)."""
        player.last_action = note
        message = interaction.message
        if player.current and player.panel and message and message.id == player.panel.id:
            await interaction.response.edit_message(
                view=NowPlayingPanel(player), allowed_mentions=NO_PINGS, **legacy_edit_kwargs(message)
            )
            return
        # Натиснули на стару панель — відповідаємо приватно, а актуальну панель оновлюємо.
        await interaction.response.send_message(embed=embeds.action(note), ephemeral=True)
        await player.update_panel()

    # ----- обробники -----

    async def cb_noop(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()

    async def cb_pause(self, interaction: discord.Interaction) -> None:
        player = _player(interaction)
        assert player is not None
        paused = player.toggle_pause()
        if paused is None:
            await reply_error(interaction, "Зараз нічого не грає.")
            return
        note = f"⏸ {_name(interaction)} поставив на паузу" if paused else f"▶️ {_name(interaction)} продовжив"
        await self.show_result(interaction, player, note)

    async def cb_restart(self, interaction: discord.Interaction) -> None:
        player = _player(interaction)
        assert player is not None
        track = player.current
        if track is None or not player.restart():
            await reply_error(interaction, "Цей трек не можна почати спочатку (трансляція або він ще готується).")
            return
        player.last_action = f"⏮ {_name(interaction)} увімкнув «{track.title[:40]}» спочатку"
        await interaction.response.defer()  # панель оновиться, щойно трек заграє з 0:00

    async def cb_skip(self, interaction: discord.Interaction) -> None:
        player = _player(interaction)
        assert player is not None
        track = player.current
        if track is None or not player.skip():
            await reply_error(interaction, "Нема чого пропускати.")
            return
        player.last_action = f"⏭ {_name(interaction)} пропустив «{track.title[:40]}»"
        await interaction.response.defer()  # панель сама оновиться, коли заграє наступний трек

    async def cb_stop(self, interaction: discord.Interaction) -> None:
        player = _player(interaction)
        assert player is not None
        player.last_action = f"⏹ {_name(interaction)} зупинив музику"
        player.stop()
        await interaction.response.defer()

    async def cb_loop(self, interaction: discord.Interaction) -> None:
        player = _player(interaction)
        assert player is not None
        mode = player.cycle_loop()
        await self.show_result(interaction, player, f"{mode.emoji} Повтор: {mode.label.lower()} — {_name(interaction)}")

    async def cb_shuffle(self, interaction: discord.Interaction) -> None:
        player = _player(interaction)
        assert player is not None
        if len(player.queue) < 2:
            await reply_error(interaction, "У черзі замало треків, щоб перемішувати.")
            return
        player.shuffle()
        await self.show_result(interaction, player, f"🔀 {_name(interaction)} перемішав чергу")

    async def cb_vol_down(self, interaction: discord.Interaction) -> None:
        await self._change_volume(interaction, -VOLUME_STEP)

    async def cb_vol_up(self, interaction: discord.Interaction) -> None:
        await self._change_volume(interaction, VOLUME_STEP)

    async def _change_volume(self, interaction: discord.Interaction, delta: int) -> None:
        player = _player(interaction)
        assert player is not None
        volume = player.set_volume(player.volume + delta)
        await self.show_result(interaction, player, f"{volume_icon(volume)} Гучність {volume}% — {_name(interaction)}")

    async def cb_jump(self, interaction: discord.Interaction) -> None:
        player = _player(interaction)
        assert player is not None
        # Значення беремо з самої взаємодії: так працює і на панелях, надісланих до перезапуску.
        values = (interaction.data or {}).get("values") or []
        position_raw, _, track_id = (values[0] if values else "").partition(":")
        if not position_raw.isdigit():
            await interaction.response.defer()
            return
        target = player.jump(int(position_raw), track_id or None)
        if target is None:
            await reply_error(interaction, "Цього треку вже нема в черзі — меню оновиться за мить.")
            await player.update_panel()
            return
        player.last_action = f"⏭ {_name(interaction)} перейшов на «{target.title[:40]}»"
        await interaction.response.defer()  # панель оновиться, коли заграє вибраний трек

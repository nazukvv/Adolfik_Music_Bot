"""Спільні перевірки і відповіді для команд і кнопок."""

from __future__ import annotations

import contextlib
import logging

import discord

from ui import embeds

log = logging.getLogger(__name__)


def voice_problem(interaction: discord.Interaction) -> str | None:
    """None, якщо користувач сидить у тому ж войсі, що й бот; інакше текст помилки."""
    guild = interaction.guild
    if guild is None:
        return "Команди працюють тільки на сервері."
    vc = guild.voice_client
    if vc is None or not isinstance(vc, discord.VoiceClient) or not vc.is_connected():
        return "Я зараз не в голосовому каналі."
    member = interaction.user
    if not isinstance(member, discord.Member) or member.voice is None or member.voice.channel != vc.channel:
        return f"Зайди в {vc.channel.mention}, щоб керувати музикою 🎧"
    return None


async def reply_error(interaction: discord.Interaction, text: str) -> None:
    """Помилка, яку бачить тільки автор (ephemeral), незалежно від стану взаємодії."""
    embed = embeds.error(text)
    try:
        if not interaction.response.is_done():
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return
        if interaction.response.type is discord.InteractionResponseType.deferred_channel_message:
            # Публічне «бот думає…» прибираємо, щоб помилку не бачив увесь канал.
            with contextlib.suppress(discord.HTTPException):
                await interaction.delete_original_response()
        await interaction.followup.send(embed=embed, ephemeral=True)
    except discord.HTTPException as exc:
        log.warning("Не вдалося показати помилку користувачу: %s", exc)


def plural(n: int, one: str, few: str, many: str) -> str:
    """Українська множина: 1 трек, 2 треки, 5 треків."""
    if n % 10 == 1 and n % 100 != 11:
        word = one
    elif 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        word = few
    else:
        word = many
    return f"{n} {word}"

"""Музичний канал: /setup, /unsetup і обробка повідомлень у каналі."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import TYPE_CHECKING, Optional

import discord
from discord import app_commands
from discord.ext import commands

from player import spawn
from stations import welcome
from ui import embeds
from ui.checks import reply_error
from youtube import YouTubeError

if TYPE_CHECKING:
    from bot import Adolfik
    from cogs.music import Music

log = logging.getLogger(__name__)

NOTICE_TTL = 8  # скільки секунд живуть підказки/помилки в музичному каналі
BOT_MESSAGE_TTL = 15  # інші повідомлення бота в каналі (відповіді на /play тощо)
CHANNEL_NAME = "🎶・музика"
CHANNEL_TOPIC = "Напиши назву пісні або кинь посилання YouTube — бот увімкне. Керування — кнопками на панелі."
NEEDED = ("view_channel", "send_messages", "embed_links", "read_message_history", "manage_messages")
NEEDED_NAMES = {
    "view_channel": "View Channel",
    "send_messages": "Send Messages",
    "embed_links": "Embed Links",
    "read_message_history": "Read Message History",
    "manage_messages": "Manage Messages",
}


class Station(commands.Cog):
    def __init__(self, bot: Adolfik) -> None:
        self.bot = bot
        self._ready_once = False

    @property
    def music(self) -> Music:
        cog = self.bot.get_cog("Music")
        assert cog is not None
        return cog  # type: ignore[return-value]

    # ---------- /setup ----------

    @app_commands.command(name="setup", description="Створити музичний канал: пишеш назву пісні — бот вмикає")
    @app_commands.rename(channel="канал")
    @app_commands.describe(channel="Наявний текстовий канал. Без значення — бот створить новий канал «музика»")
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.guild_only()
    async def setup_cmd(self, interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None) -> None:
        guild = interaction.guild
        assert guild is not None
        await interaction.response.defer(ephemeral=True, thinking=True)

        if channel is None:
            if not guild.me.guild_permissions.manage_channels:
                await reply_error(
                    interaction,
                    "У мене нема права **Manage Channels**, тому сам канал створити не можу. "
                    "Створи текстовий канал вручну і виклич `/setup канал:#твій-канал`.",
                )
                return
            try:
                channel = await guild.create_text_channel(
                    CHANNEL_NAME, topic=CHANNEL_TOPIC, slowmode_delay=2, reason=f"/setup від {interaction.user}"
                )
            except discord.HTTPException as exc:
                await reply_error(interaction, f"Не вдалося створити канал: {exc}")
                return

        perms = channel.permissions_for(guild.me)
        missing = [NEEDED_NAMES[p] for p in NEEDED if not getattr(perms, p)]
        hard_missing = [m for m in missing if m != "Manage Messages"]
        if hard_missing:
            await reply_error(
                interaction, f"У {channel.mention} мені бракує прав: **{', '.join(hard_missing)}**. Дай їх і спробуй ще раз."
            )
            return

        # Спершу забуваємо стару панель, щоб on_raw_message_delete не відновив її.
        old = self.bot.stations.forget(guild.id)
        if old:
            old_channel = guild.get_channel(old.channel_id)
            if isinstance(old_channel, discord.TextChannel):
                with contextlib.suppress(discord.HTTPException):
                    await old_channel.get_partial_message(old.message_id).delete()

        player = self.bot.players.get(guild.id)
        try:
            message = await channel.send(embed=welcome(guild))
        except discord.HTTPException as exc:
            await reply_error(interaction, f"Не вдалося надіслати панель у {channel.mention}: {exc}")
            return
        self.bot.stations.set(guild.id, channel.id, message.id)
        if player is not None:
            player.text_channel = channel
            player.panel = None
            if player.current:
                spawn(player.update_panel())

        text = f"Готово! Музичний канал: {channel.mention}. Пишіть туди назви пісень 🎶"
        if missing:
            text += (
                "\n\n⚠️ Нема права **Manage Messages** у цьому каналі — я не зможу прибирати ваші повідомлення. "
                "Додай його моїй ролі в налаштуваннях каналу."
            )
        if not self.bot.intents.message_content:
            text += "\n\n⚠️ Вимкнений Message Content Intent — я не бачитиму текст повідомлень."
        await interaction.followup.send(embed=embeds.success(text), ephemeral=True)
        log.info("[%s] Музичний канал: #%s (%s)", guild.name, channel.name, channel.id)

    @app_commands.command(name="unsetup", description="Вимкнути музичний канал (сам канал залишиться)")
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.guild_only()
    async def unsetup_cmd(self, interaction: discord.Interaction) -> None:
        guild = interaction.guild
        assert guild is not None
        station = self.bot.stations.forget(guild.id)
        if station is None:
            await reply_error(interaction, "Музичний канал і так не налаштований. Створити — /setup")
            return
        channel = guild.get_channel(station.channel_id)
        if isinstance(channel, discord.TextChannel):
            with contextlib.suppress(discord.HTTPException):
                await channel.get_partial_message(station.message_id).delete()
        player = self.bot.players.get(guild.id)
        if player is not None:
            player.panel = None
        await interaction.response.send_message(
            embed=embeds.success("Музичний канал вимкнено. /play працює як раніше."), ephemeral=True
        )

    # ---------- повідомлення в каналі ----------

    async def _delete_bot_message_later(self, message: discord.Message) -> None:
        await asyncio.sleep(BOT_MESSAGE_TTL)
        guild = message.guild
        station = self.bot.stations.get(guild.id if guild else None)
        # Перевіряємо в момент видалення: нова панель могла щойно отримати цей id.
        if station is None or message.id == station.message_id:
            return
        player = self.bot.players.get(guild.id if guild else None)
        if player and player.panel and player.panel.id == message.id:
            return
        with contextlib.suppress(discord.HTTPException):
            await message.delete()

    async def _notice(self, channel: discord.TextChannel, embed: discord.Embed, user: discord.abc.User) -> None:
        with contextlib.suppress(discord.HTTPException):
            await channel.send(
                content=user.mention,
                embed=embed,
                delete_after=NOTICE_TTL,
                allowed_mentions=discord.AllowedMentions(users=False),
            )

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        guild = message.guild
        if guild is None or not isinstance(message.channel, discord.TextChannel):
            return
        station = self.bot.stations.get(guild.id)
        if station is None or message.channel.id != station.channel_id:
            return
        channel = message.channel

        if message.author.bot:
            # Відповіді бота на slash-команди теж прибираємо, щоб у каналі лишалась тільки панель.
            if self.bot.user and message.author.id == self.bot.user.id and not message.flags.ephemeral:
                spawn(self._delete_bot_message_later(message))
            return
        if message.type not in (discord.MessageType.default, discord.MessageType.reply):
            return

        query = message.content.strip()
        with contextlib.suppress(discord.HTTPException):
            await message.delete()

        if not query:
            if not self.bot.intents.message_content:
                log.warning("Message Content Intent вимкнений — бот не бачить текст у музичному каналі")
            await self._notice(channel, embeds.info("Напиши назву пісні або кинь посилання YouTube 🎵"), message.author)
            return

        if problem := self.music.join_problem(message.author, guild):
            await self._notice(channel, embeds.error(problem), message.author)
            return

        try:
            async with channel.typing():
                resolved = await self.bot.yt.resolve(query[:300])
                embed = await self.music.enqueue(message.author, channel, resolved)  # type: ignore[arg-type]
        except YouTubeError as exc:
            await self._notice(channel, embeds.error(str(exc)), message.author)
            return
        except Exception as exc:
            from cogs.music import JoinError

            if isinstance(exc, JoinError):
                await self._notice(channel, embeds.error(str(exc)), message.author)
                return
            log.exception("Помилка в музичному каналі")
            await self._notice(channel, embeds.error("Щось пішло не так 😵 Подробиці в logs/bot.log."), message.author)
            return
        await self._notice(channel, embed, message.author)

    # ---------- підтримка панелі ----------

    @commands.Cog.listener()
    async def on_ready(self) -> None:
        if self._ready_once:
            return
        self._ready_once = True
        for guild_id in self.bot.stations.all():
            guild = self.bot.get_guild(guild_id)
            if guild is None:
                continue
            player = self.bot.players.get(guild_id)
            if player and player.current:
                spawn(player.update_panel())
            else:
                await self.bot.stations.show_welcome(guild)

    @commands.Cog.listener()
    async def on_raw_message_delete(self, payload: discord.RawMessageDeleteEvent) -> None:
        station = self.bot.stations.get(payload.guild_id)
        if station is None or payload.message_id != station.message_id:
            return
        guild = self.bot.get_guild(payload.guild_id or 0)
        if guild is None:
            return
        await asyncio.sleep(1)
        player = self.bot.players.get(guild.id)
        if player and player.current:
            player.panel = None
            await player.update_panel()
        else:
            await self.bot.stations.show_welcome(guild)

    @commands.Cog.listener()
    async def on_guild_channel_delete(self, channel: discord.abc.GuildChannel) -> None:
        station = self.bot.stations.get(channel.guild.id)
        if station and station.channel_id == channel.id:
            self.bot.stations.forget(channel.guild.id)
            log.info("[%s] Музичний канал видалено — налаштування скинуто", channel.guild.name)


async def setup(bot: Adolfik) -> None:
    await bot.add_cog(Station(bot))

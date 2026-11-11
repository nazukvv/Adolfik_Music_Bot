"""Веб-сервер Discord Activity у процесі бота: REST API, WebSocket стану і роздача фронтенду (activity/dist).

Працює в тому ж asyncio loop, що й бот, тому має прямий доступ до bot.players і bot.yt.
Слухає тільки 127.0.0.1: назовні його виставляє тунель (cloudflared), а в Discord він доступний через
проксі https://<CLIENT_ID>.discordsays.com за URL mapping «/».

Авторизація: SDK authorize → код → POST /api/token → сесія (webapi/auth.py). Дивитися стан може будь-хто
з сервера; керувати — тільки той, хто сидить у тому ж войсі, що й бот (як кнопки панелі).
"""

from __future__ import annotations

import asyncio
import contextlib
import functools
import json
import logging
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import aiohttp
import discord
from aiohttp import web

from cogs.music import JoinError
from config import BASE_DIR
from player import spawn
from webapi import auth
from webapi.auth import Identity
from webapi.errors import ApiError
from webapi.library import LibraryError, Owner
from webapi.library_api import LibraryApi
from webapi.state import LOOP_BY_NAME, bot_channel, guild_state, track_json, you_json
from youtube import Resolved, YouTubeError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from bot import Adolfik
    from cogs.music import Music
    from player import GuildPlayer

log = logging.getLogger(__name__)

DIST_DIR = BASE_DIR / "activity" / "dist"
DISCORD_API = "https://discord.com/api/v10"
POSITION_INTERVAL = 1.5  # як часто слати позицію треку в WebSocket (між ними фронтенд інтерполює сам)
BROADCAST_DELAY = 0.15  # зміни, що йдуть пачкою (додали плейлист…), зливаємо в одне повідомлення
MEMBER_TTL = 300
WS_AUTH_TIMEOUT = 10
SEARCH_LIMIT = 20
# Запит із такими заголовками прийшов через тунель / проксі Discord — DEV_MODE для нього не діє.
FORWARDED_HEADERS = ("X-Forwarded-For", "CF-Connecting-IP", "CF-Ray", "X-Forwarded-Host", "Forwarded")
LOCALHOST = {"127.0.0.1", "::1"}

_dumps = functools.partial(json.dumps, ensure_ascii=False, separators=(",", ":"))

PLACEHOLDER_HTML = """<!doctype html><html lang="uk"><meta charset="utf-8"><title>Adolfik</title>
<body style="background:#0f0f0f;color:#eee;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>🎶 Adolfik Activity</h1><p>API працює, але фронтенд ще не зібрано.</p>
<p style="opacity:.6">cd activity &amp;&amp; npm ci &amp;&amp; npm run build</p></div></body></html>"""


@dataclass(eq=False, slots=True)
class Client:
    ws: web.WebSocketResponse
    guild_id: int
    member: discord.Member


class ActivityServer(LibraryApi):
    # Базова адреса Discord API (тести підставляють сюди локальний сервер-заглушку).
    discord_api = DISCORD_API

    def __init__(self, bot: Adolfik) -> None:
        self.bot = bot
        self.settings = bot.settings
        self.secret = self.settings.session_secret
        self.http: aiohttp.ClientSession | None = None
        self._runner: web.AppRunner | None = None
        self._ticker: asyncio.Task[None] | None = None
        self._unsubscribe: Callable[[], None] | None = None
        self._clients: defaultdict[int, set[Client]] = defaultdict(set)
        self._pending: set[int] = set()
        self._members: dict[tuple[int, int], tuple[float, discord.Member | None]] = {}
        self._rate: dict[tuple[Any, str], deque[float]] = {}

        self.app = web.Application(middlewares=[self._errors], client_max_size=64 * 1024)
        r = self.app.router
        r.add_get("/api/health", self.health)
        r.add_get("/api/config", self.config)
        r.add_post("/api/token", self.token)
        self._add_library_routes(r)  # /api/me/... — профіль, лайки, плейлисти; /api/history
        r.add_get("/api/dev/guilds", self.dev_guilds)
        r.add_get("/api/state", self.state)
        r.add_get("/api/search", self.search)
        r.add_post("/api/play", self.play)
        r.add_post("/api/control", self.control)
        r.add_post("/api/queue/move", self.queue_move)
        r.add_post("/api/queue/remove", self.queue_remove)
        r.add_post("/api/queue/jump", self.queue_jump)
        r.add_post("/api/summon", self.summon)
        r.add_get("/api/ws", self.websocket)
        r.add_route("*", "/api/{tail:.*}", self.not_found)
        r.add_get("/{path:.*}", self.static)

    # ---------- життєвий цикл ----------

    @property
    def running(self) -> bool:
        return self._runner is not None

    async def start(self) -> None:
        s = self.settings
        if not s.web_enabled:
            log.info("Activity вимкнена: нема DISCORD_CLIENT_SECRET у .env (і DEV_MODE вимкнено)")
            return
        if s.dev_mode:
            log.warning(
                "Activity: DEV_MODE — API працює без Discord-авторизації, лише для запитів з localhost. "
                "Не вмикай DEV_MODE разом із тунелем!"
            )
        if not self.secret:
            self.secret = secrets.token_urlsafe(32)
            log.warning("Activity: SESSION_SECRET не задано — сесії скидатимуться при кожному перезапуску бота")
        self.http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        self._unsubscribe = self.bot.players.subscribe(self._on_change)
        runner = web.AppRunner(self.app, access_log=None)
        await runner.setup()
        try:
            await web.TCPSite(runner, s.web_host, s.web_port).start()
        except OSError as exc:
            log.error(
                "Activity: не вдалося запустити веб-сервер на %s:%d — %s. Порт зайнятий? Зміни WEB_PORT у .env",
                s.web_host,
                s.web_port,
                exc,
            )
            await runner.cleanup()
            await self._release()
            return
        self._runner = runner
        self._ticker = asyncio.create_task(self._position_loop(), name="activity-position")
        built = (DIST_DIR / "index.html").is_file()
        log.info(
            "Activity: веб-сервер на http://%s:%d%s (фронтенд %s)",
            s.web_host,
            s.web_port,
            ", DEV_MODE" if s.dev_mode else "",
            "зібрано" if built else "ще не зібрано",
        )

    async def stop(self) -> None:
        if self._ticker:
            self._ticker.cancel()
            self._ticker = None
        for clients in list(self._clients.values()):
            for client in list(clients):
                with contextlib.suppress(Exception):
                    await client.ws.close(code=1001, message=b"server shutdown")
        self._clients.clear()
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
        await self._release()

    async def _release(self) -> None:
        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None
        if self.http:
            await self.http.close()
            self.http = None

    # ---------- допоміжне ----------

    @web.middleware
    async def _errors(
        self, request: web.Request, handler: Callable[[web.Request], Awaitable[web.StreamResponse]]
    ) -> web.StreamResponse:
        try:
            return await handler(request)
        except ApiError as exc:
            payload = {"error": exc.message} | ({"code": exc.code} if exc.code else {})
            return self._json(payload, exc.status)
        except LibraryError as exc:
            return self._json({"error": exc.message}, exc.status)
        except web.HTTPException:
            raise
        except Exception:
            log.exception("Activity API: помилка в %s %s", request.method, request.path)
            return self._json({"error": "Внутрішня помилка сервера 😵"}, 500)

    @staticmethod
    def _json(data: Any, status: int = 200) -> web.Response:
        return web.json_response(data, status=status, dumps=_dumps)

    @staticmethod
    async def _body(request: web.Request) -> dict[str, Any]:
        if not request.can_read_body:
            return {}
        try:
            data = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ApiError(400, "Тіло запиту має бути JSON") from exc
        if not isinstance(data, dict):
            raise ApiError(400, "Тіло запиту має бути JSON-об'єктом")
        return data

    def _limit(self, who: Any, key: str, count: int, per: float) -> None:
        bucket = self._rate.setdefault((who, key), deque())
        now = time.monotonic()
        while bucket and now - bucket[0] > per:
            bucket.popleft()
        if len(bucket) >= count:
            raise ApiError(429, "Забагато запитів — зачекай секунду")
        bucket.append(now)

    @staticmethod
    def _client_ip(request: web.Request) -> str:
        """IP користувача для лімітів: за тунелем і проксі Discord request.remote у всіх 127.0.0.1."""
        forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        return forwarded or request.headers.get("CF-Connecting-IP", "") or request.remote or "?"

    def _dev_identity(self, request: web.Request, raw: str | None = None) -> Identity:
        if not self.settings.dev_mode:
            raise ApiError(401, "Потрібна авторизація Discord — відкрий Activity з голосового каналу")
        if request.remote not in LOCALHOST or any(h in request.headers for h in FORWARDED_HEADERS):
            raise ApiError(401, "DEV_MODE працює тільки для localhost; через тунель потрібна авторизація Discord")
        raw = raw or request.query.get("user") or request.headers.get("X-Dev-User") or ""
        if not raw and self.settings.dev_user_id:
            raw = str(self.settings.dev_user_id)
        if not raw.isdigit():
            raise ApiError(401, "DEV_MODE: передай ?user=<твій Discord ID> або задай DEV_USER_ID у .env")
        return Identity(user_id=int(raw), name=f"dev:{raw}", dev=True)

    def _identity(self, request: web.Request) -> Identity:
        header = request.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            identity = auth.verify(self.secret, header.removeprefix("Bearer ").strip())
            if identity is None:
                raise ApiError(401, "Сесія недійсна або прострочена — відкрий Activity заново")
            return identity
        return self._dev_identity(request)

    @staticmethod
    def _guild_id(request: web.Request, body: dict[str, Any] | None = None) -> int:
        raw = str((body or {}).get("guild") or request.query.get("guild") or "")
        if not raw.isdigit():
            raise ApiError(400, "Не вказано guild")
        return int(raw)

    async def _member(self, guild: discord.Guild, user_id: int) -> discord.Member | None:
        member = guild.get_member(user_id)
        if member is not None:
            return member
        key = (guild.id, user_id)
        hit = self._members.get(key)
        if hit and time.monotonic() - hit[0] < MEMBER_TTL:
            return hit[1]
        try:
            member = await guild.fetch_member(user_id)
        except discord.NotFound:
            member = None
        except discord.HTTPException as exc:
            raise ApiError(502, f"Discord не відповів: {exc}") from exc
        if len(self._members) > 5000:
            self._members.clear()
        self._members[key] = (time.monotonic(), member)
        return member

    async def _resolve(
        self, request: web.Request, identity: Identity, body: dict[str, Any] | None = None
    ) -> tuple[discord.Guild, discord.Member]:
        if not self.bot.is_ready():
            raise ApiError(503, "Бот ще підключається до Discord — спробуй за кілька секунд")
        guild = self.bot.get_guild(self._guild_id(request, body))
        if guild is None:
            raise ApiError(404, "Бота нема на цьому сервері — спершу запроси його (посилання є в логах бота)")
        member = await self._member(guild, identity.user_id)
        if member is None:
            raise ApiError(403, "Ти не учасник цього сервера")
        return guild, member

    async def _context(
        self, request: web.Request, body: dict[str, Any] | None = None
    ) -> tuple[Identity, discord.Guild, discord.Member]:
        identity = self._identity(request)
        guild, member = await self._resolve(request, identity, body)
        return identity, guild, member

    def _controlled(self, guild: discord.Guild, member: discord.Member) -> GuildPlayer:
        """Плеєр, яким member має право керувати (сидить у тому ж войсі, що й бот)."""
        channel = bot_channel(guild)
        if channel is None:
            raise ApiError(409, "Бот зараз не в голосовому каналі")
        if member.voice is None or member.voice.channel != channel:
            raise ApiError(403, f"Зайди в «{channel.name}», щоб керувати музикою 🎧")
        player = self.bot.players.get(guild.id)
        if player is None:
            raise ApiError(409, "Зараз нічого не грає")
        return player

    def _state(self, guild: discord.Guild, member: discord.Member) -> dict[str, Any]:
        return {**guild_state(self.bot, guild), "you": you_json(guild, member)}

    def _music(self) -> Music:
        cog = self.bot.get_cog("Music")
        if cog is None:
            raise ApiError(503, "Музичний модуль не завантажено")
        return cog  # type: ignore[return-value]

    @staticmethod
    def _int(body: dict[str, Any], key: str) -> int:
        value = body.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            raise ApiError(400, f"Поле «{key}» має бути цілим числом")
        return value

    def _queue_position(self, player: GuildPlayer, body: dict[str, Any], key: str = "index") -> int:
        """Позиція в черзі (з 1) за індексом із фронтенду (з 0). Якщо передано id і черга встигла
        зсунутись, шукаємо трек за id."""
        position = self._int(body, key) + 1
        track_id = body.get("id")
        queue = player.queue
        if isinstance(track_id, str) and track_id:
            if not (1 <= position <= len(queue) and queue[position - 1].id == track_id):
                position = next((i for i, t in enumerate(queue, start=1) if t.id == track_id), 0)
        if not 1 <= position <= len(queue):
            raise ApiError(409, "Цього треку вже нема в черзі")
        return position

    # ---------- службові ----------

    async def health(self, request: web.Request) -> web.Response:
        return self._json(
            {
                "ok": True,
                "ready": self.bot.is_ready(),
                "dev_mode": self.settings.dev_mode,
                "frontend": (DIST_DIR / "index.html").is_file(),
            }
        )

    async def config(self, request: web.Request) -> web.Response:
        client_id = self.settings.client_id or self.bot.application_id
        return self._json({"client_id": str(client_id) if client_id else None, "dev_mode": self.settings.dev_mode})

    async def not_found(self, request: web.Request) -> web.Response:
        raise ApiError(404, "Нема такого API")

    # ---------- авторизація ----------

    async def token(self, request: web.Request) -> web.Response:
        """Обмін OAuth2-коду з SDK authorize на access_token + наша сесія."""
        if not self.settings.client_secret:
            raise ApiError(503, "На сервері не задано DISCORD_CLIENT_SECRET")
        self._limit(self._client_ip(request), "token", 20, 60)
        body = await self._body(request)
        code = body.get("code")
        if not isinstance(code, str) or not code:
            raise ApiError(400, "Нема коду авторизації")
        assert self.http is not None
        client_id = self.settings.client_id or self.bot.application_id
        form = {
            "client_id": str(client_id),
            "client_secret": self.settings.client_secret,
            "grant_type": "authorization_code",
            "code": code,
        }
        try:
            async with self.http.post(f"{self.discord_api}/oauth2/token", data=form) as resp:
                token_data = await resp.json(content_type=None)
                if resp.status != 200 or "access_token" not in token_data:
                    log.warning(
                        "Activity: Discord не прийняв OAuth2-код (%s): %s",
                        resp.status,
                        token_data.get("error_description") or token_data.get("error"),
                    )
                    raise ApiError(401, "Discord не прийняв код авторизації")
            access_token = token_data["access_token"]
            async with self.http.get(
                f"{self.discord_api}/users/@me", headers={"Authorization": f"Bearer {access_token}"}
            ) as resp:
                user = await resp.json(content_type=None)
                if resp.status != 200 or "id" not in user:
                    raise ApiError(401, "Не вдалося отримати профіль Discord")
        except (aiohttp.ClientError, TimeoutError) as exc:
            raise ApiError(502, f"Discord не відповів: {exc}") from exc

        user_id = int(user["id"])
        name = str(user.get("global_name") or user.get("username") or user_id)
        avatar = (
            f"https://cdn.discordapp.com/avatars/{user_id}/{user['avatar']}.png?size=64" if user.get("avatar") else None
        )
        session = auth.issue(self.secret, user_id=user_id, name=name, avatar=avatar)
        library = getattr(self.bot, "library", None)
        if library is not None:  # профіль створюється (або оновлюється) при кожному вході
            try:
                await library.touch_user(Owner(user_id, name, avatar))
            except Exception:
                log.exception("Activity: не вдалося зберегти профіль %s", user_id)
        log.info("Activity: увійшов %s (%s)", name, user_id)
        return self._json(
            {
                "access_token": access_token,
                "session": session,
                "user": {"id": str(user_id), "name": name, "avatar": avatar},
            }
        )

    async def dev_guilds(self, request: web.Request) -> web.Response:
        """DEV_MODE: сервери бота, щоб у браузері вибрати, яким керувати (у Discord guild дає SDK)."""
        identity = self._dev_identity(request)
        guilds = []
        for guild in self.bot.guilds:
            channel = bot_channel(guild)
            guilds.append(
                {
                    "id": str(guild.id),
                    "name": guild.name,
                    "icon": guild.icon.with_size(64).url if guild.icon else None,
                    "member_count": guild.member_count,
                    "voice_channel": channel.name if channel else None,
                    "you_are_member": guild.get_member(identity.user_id) is not None,
                }
            )
        return self._json({"guilds": guilds})

    # ---------- читання ----------

    async def state(self, request: web.Request) -> web.Response:
        _, guild, member = await self._context(request)
        return self._json(self._state(guild, member))

    async def search(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        query = request.query.get("q", "").strip()
        if len(query) < 2:
            return self._json({"query": query, "results": []})
        self._limit(identity.user_id, "search", 20, 10)
        try:
            tracks = await self.bot.yt.search(query[:200], limit=SEARCH_LIMIT)
        except YouTubeError as exc:
            raise ApiError(502, str(exc)) from exc
        return self._json({"query": query, "results": [track_json(t) for t in tracks]})

    # ---------- керування ----------

    def _check_can_play(self, guild: discord.Guild, member: discord.Member, summon: bool) -> None:
        """Activity сама бота не кличе: якщо його нема у твоєму войсі, грати можна лише з summon=true
        (одна кнопка «Покликати й грати»). /play і музичний канал працюють як раніше — їх це не стосується."""
        voice = member.voice.channel if member.voice else None
        if voice is None:
            raise ApiError(409, "Спершу зайди в голосовий канал 🎧", code="not_in_voice")
        channel = bot_channel(guild)
        if channel != voice and not summon:
            text = (
                "Спершу поклич бота у свій войс"
                if channel is None
                else f"Бот зараз у «{channel.name}» — поклич його до себе"
            )
            raise ApiError(409, text, code="summon_required")
        if problem := self._music().join_problem(member, guild):
            raise ApiError(409, problem)

    async def _enqueue_for(
        self, guild: discord.Guild, member: discord.Member, resolved: Resolved, mode: Any, summon: bool
    ) -> web.Response:
        """Поставити треки в чергу через ту саму логіку, що й /play (Music.enqueue_tracks)."""
        if mode not in ("queue", "next", "now"):
            raise ApiError(400, "mode має бути queue, next або now")
        self._check_can_play(guild, member, summon)
        music = self._music()
        existing = self.bot.players.get(guild.id)
        voice = member.voice.channel if member.voice else None
        text_channel = existing.text_channel if existing else voice
        try:
            result = await music.enqueue_tracks(member, text_channel, resolved)  # type: ignore[arg-type]
        except JoinError as exc:
            raise ApiError(409, str(exc)) from exc

        player = result.player
        position = result.position
        if mode in ("next", "now") and not result.starting:
            for offset in range(len(result.tracks)):  # переносимо доданий блок на початок черги
                player.move(result.position + offset, 1 + offset)
            position = 1
            if mode == "now":
                player.skip()
        title = resolved.playlist_title or result.tracks[0].title
        if result.starting or mode == "now":
            verb = "увімкнув"
        elif mode == "next":
            verb = "поставив наступним"
        else:
            verb = "додав"
        player.last_action = f"➕ {member.display_name} {verb} «{title[:40]}»"
        return self._json(
            {
                "ok": True,
                "added": len(result.tracks),
                "position": position,
                "starting": result.starting,
                "state": self._state(guild, member),
            }
        )

    async def play(self, request: web.Request) -> web.Response:
        """{guild, query|url, mode: queue|next|now, summon?} — summon=true кличе бота, якщо його нема у войсі."""
        body = await self._body(request)
        identity, guild, member = await self._context(request, body)
        self._limit(identity.user_id, "play", 8, 10)
        query = str(body.get("url") or body.get("query") or "").strip()[:300]
        if not query:
            raise ApiError(400, "Нема що вмикати: передай query або url")
        summon = bool(body.get("summon"))
        self._check_can_play(guild, member, summon)  # швидко, ще до запиту в YouTube
        try:
            resolved = await self.bot.yt.resolve(query)
        except YouTubeError as exc:
            raise ApiError(400, str(exc)) from exc
        return await self._enqueue_for(guild, member, resolved, body.get("mode", "queue"), summon)

    async def control(self, request: web.Request) -> web.Response:
        """{guild, action, value?}: pause | resume | toggle | skip | stop | previous_restart | seek | volume | loop
        | shuffle."""
        body = await self._body(request)
        identity, guild, member = await self._context(request, body)
        self._limit(identity.user_id, "control", 30, 10)
        player = self._controlled(guild, member)
        name = member.display_name
        action = body.get("action")
        value = body.get("value")
        panel_refresh = True  # skip/stop/seek самі оновлюють панель, коли заграє трек

        if action in ("pause", "resume", "toggle"):
            want_pause = not player.is_paused if action == "toggle" else action == "pause"
            if want_pause != player.is_paused and player.toggle_pause() is None:
                raise ApiError(409, "Зараз нічого не грає")
            note = f"⏸ {name} поставив на паузу" if player.is_paused else f"▶️ {name} продовжив"
        elif action == "skip":
            track = player.current
            if track is None or not player.skip():
                raise ApiError(409, "Нема чого пропускати")
            note = f"⏭ {name} пропустив «{track.title[:40]}»"
            panel_refresh = False
        elif action == "stop":
            player.stop()
            note = f"⏹ {name} зупинив музику"
            panel_refresh = False
        elif action in ("previous_restart", "restart"):
            track = player.current
            if track is None or not player.restart():
                raise ApiError(409, "Цей трек не можна почати спочатку (трансляція або він ще готується)")
            note = f"⏮ {name} увімкнув «{track.title[:40]}» спочатку"
            panel_refresh = False
        elif action == "seek":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ApiError(400, "Для seek потрібне value — секунда, на яку перемотати")
            if not player.seek(float(value)):
                raise ApiError(409, "Перемотати зараз не можна (трансляція або трек ще готується)")
            minutes, seconds = divmod(int(value), 60)
            note = f"⏩ {name} перемотав на {minutes}:{seconds:02}"
            panel_refresh = False
        elif action == "volume":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ApiError(400, "Для volume потрібне value 0–150")
            volume = player.set_volume(int(value))
            note = f"🔊 Гучність {volume}% — {name}"
        elif action == "loop":
            mode = player.set_loop(LOOP_BY_NAME[value]) if value in LOOP_BY_NAME else player.cycle_loop()
            note = f"{mode.emoji} Повтор: {mode.label.lower()} — {name}"
        elif action == "shuffle":
            if len(player.queue) < 2:
                raise ApiError(409, "У черзі замало треків, щоб перемішувати")
            player.shuffle()
            note = f"🔀 {name} перемішав чергу"
        else:
            raise ApiError(400, f"Невідома дія: {action!r}")

        player.last_action = note
        if panel_refresh:
            spawn(player.update_panel())
        return self._json({"ok": True, "state": self._state(guild, member)})

    async def queue_move(self, request: web.Request) -> web.Response:
        """{guild, from, to, id?} — індекси з 0."""
        body = await self._body(request)
        _, guild, member = await self._context(request, body)
        player = self._controlled(guild, member)
        source = self._queue_position(player, body, "from")
        target = max(1, min(len(player.queue), self._int(body, "to") + 1))
        track = player.move(source, target)
        if track is None:
            raise ApiError(409, "Не вдалося перемістити трек")
        player.last_action = f"↕️ {member.display_name} перемістив «{track.title[:40]}»"
        spawn(player.update_panel())
        return self._json({"ok": True, "state": self._state(guild, member)})

    async def queue_remove(self, request: web.Request) -> web.Response:
        """{guild, index, id?}"""
        body = await self._body(request)
        _, guild, member = await self._context(request, body)
        player = self._controlled(guild, member)
        track = player.remove(self._queue_position(player, body))
        if track is None:
            raise ApiError(409, "Цього треку вже нема в черзі")
        player.last_action = f"🗑 {member.display_name} прибрав «{track.title[:40]}»"
        spawn(player.update_panel())
        return self._json({"ok": True, "state": self._state(guild, member)})

    async def queue_jump(self, request: web.Request) -> web.Response:
        """{guild, index, id?} — перейти на трек (треки перед ним прибираються)."""
        body = await self._body(request)
        _, guild, member = await self._context(request, body)
        player = self._controlled(guild, member)
        position = self._queue_position(player, body)
        target = player.jump(position, player.queue[position - 1].id)
        if target is None:
            raise ApiError(409, "Цього треку вже нема в черзі")
        player.last_action = f"⏭ {member.display_name} перейшов на «{target.title[:40]}»"
        return self._json({"ok": True, "state": self._state(guild, member)})

    async def summon(self, request: web.Request) -> web.Response:
        """{guild, channel_id} — покликати бота у войс, де сидить користувач (і запущено Activity)."""
        body = await self._body(request)
        identity, guild, member = await self._context(request, body)
        self._limit(identity.user_id, "summon", 3, 10)
        channel_id = str(body.get("channel_id") or "")
        voice = member.voice.channel if member.voice else None
        if voice is None or str(voice.id) != channel_id:
            raise ApiError(403, "Спершу зайди в цей голосовий канал 🎧")
        if problem := self._music().join_problem(member, guild):
            raise ApiError(409, problem)
        existing = self.bot.players.get(guild.id)
        try:
            player = await self.bot.players.join(voice, existing.text_channel if existing else voice)  # type: ignore[arg-type]
        except TimeoutError as exc:
            raise ApiError(504, "Не вдалося підключитися до голосового каналу (таймаут)") from exc
        except (discord.ClientException, RuntimeError) as exc:
            raise ApiError(409, f"Не вдалося підключитися до войсу: {exc}") from exc
        player.last_action = f"👋 {member.display_name} покликав мене в «{voice.name}»"
        return self._json({"ok": True, "state": self._state(guild, member)})

    # ---------- WebSocket ----------

    async def websocket(self, request: web.Request) -> web.WebSocketResponse:
        """/api/ws?guild=… — повний стан при підключенні й після кожної зміни, позиція раз на 1.5 с.

        Авторизація першим повідомленням {"type":"auth","session":"…"} (у DEV_MODE можна ?user=<id>).
        """
        guild_id = self._guild_id(request)
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=64 * 1024)
        await ws.prepare(request)
        client: Client | None = None
        try:
            try:
                identity = await self._ws_identity(request, ws)
                guild, member = await self._resolve(request, identity, {"guild": guild_id})
            except ApiError as exc:
                with contextlib.suppress(Exception):
                    await ws.send_str(_dumps({"type": "error", "status": exc.status, "error": exc.message}))
                    await ws.close(code=4000 + exc.status % 1000, message=b"error")
                return ws

            client = Client(ws=ws, guild_id=guild.id, member=member)
            self._clients[guild.id].add(client)
            await self._send(client, self._state(guild, member))
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                kind = data.get("type") if isinstance(data, dict) else None
                if kind == "ping":
                    await ws.send_str('{"type":"pong"}')
                elif kind == "state":
                    await self._send(client, self._state(guild, member))
        finally:
            if client is not None:
                clients = self._clients.get(client.guild_id)
                if clients is not None:
                    clients.discard(client)
                    if not clients:
                        self._clients.pop(client.guild_id, None)
        return ws

    async def _ws_identity(self, request: web.Request, ws: web.WebSocketResponse) -> Identity:
        if self.settings.dev_mode and request.query.get("user"):
            return self._dev_identity(request)
        try:
            msg = await ws.receive(timeout=WS_AUTH_TIMEOUT)
        except TimeoutError as exc:
            raise ApiError(401, "Не отримав авторизацію") from exc
        if msg.type != aiohttp.WSMsgType.TEXT:
            raise ApiError(401, "Не отримав авторизацію")
        try:
            data = json.loads(msg.data)
        except ValueError as exc:
            raise ApiError(400, "Перше повідомлення має бути JSON") from exc
        if not isinstance(data, dict) or data.get("type") != "auth":
            raise ApiError(401, 'Перше повідомлення має бути {"type":"auth","session":"…"}')
        identity = auth.verify(self.secret, data.get("session"))
        if identity is not None:
            return identity
        if self.settings.dev_mode and not data.get("session"):
            # DEV_MODE: користувач з повідомлення, інакше DEV_USER_ID із .env
            return self._dev_identity(request, str(data.get("user") or "") or None)
        raise ApiError(401, "Сесія недійсна або прострочена — відкрий Activity заново")

    def _on_change(self, guild_id: int) -> None:
        """Підписка на PlayerManager: позначаємо сервер «змінився» і за мить шлемо стан усім у ньому."""
        if guild_id not in self._clients or guild_id in self._pending:
            return
        self._pending.add(guild_id)
        asyncio.get_running_loop().call_later(BROADCAST_DELAY, lambda: spawn(self._flush(guild_id)))

    async def _flush(self, guild_id: int) -> None:
        self._pending.discard(guild_id)
        clients = self._clients.get(guild_id)
        guild = self.bot.get_guild(guild_id)
        if not clients or guild is None:
            return
        base = guild_state(self.bot, guild)
        for client in list(clients):
            await self._send(client, {**base, "you": you_json(guild, client.member)})

    def library_event(self, user_id: int, what: str, **data: Any) -> None:
        """Змінилась бібліотека користувача (лайки, плейлисти, видалення даних) — повідомити всі його вкладки,
        зокрема коли лайк поставлено кнопкою ❤ на панелі в Discord."""
        payload = {"type": "library", "what": what, **data}
        for clients in list(self._clients.values()):
            for client in list(clients):
                if client.member.id == user_id:
                    spawn(self._send(client, payload))

    async def _send(self, client: Client, payload: dict[str, Any]) -> None:
        if client.ws.closed:
            self._clients.get(client.guild_id, set()).discard(client)
            return
        try:
            await client.ws.send_str(_dumps(payload))
        except (ConnectionResetError, RuntimeError, aiohttp.ClientError):
            self._clients.get(client.guild_id, set()).discard(client)

    async def _position_loop(self) -> None:
        while True:
            await asyncio.sleep(POSITION_INTERVAL)
            try:
                for guild_id, clients in list(self._clients.items()):
                    player = self.bot.players.get(guild_id)
                    vc = player.voice if player else None
                    if not clients or player is None or player.current is None or player.source is None:
                        continue
                    if vc is None or not vc.is_playing():
                        continue
                    payload = {
                        "type": "position",
                        "track_id": player.current.id,
                        "position": round(player.position, 2),
                        "paused": False,
                        "server_time": time.time(),
                    }
                    for client in list(clients):
                        await self._send(client, payload)
            except Exception:
                log.exception("Activity: помилка розсилки позиції")

    # ---------- фронтенд ----------

    async def static(self, request: web.Request) -> web.StreamResponse:
        """Збірка activity/dist; невідомі шляхи віддають index.html (SPA)."""
        index = DIST_DIR / "index.html"
        if not index.is_file():
            return web.Response(text=PLACEHOLDER_HTML, content_type="text/html")
        relative = request.match_info.get("path", "")
        if relative:
            target = (DIST_DIR / relative).resolve()
            if target.is_relative_to(DIST_DIR.resolve()) and target.is_file():
                cache = "public, max-age=31536000, immutable" if relative.startswith("assets/") else "no-cache"
                return web.FileResponse(target, headers={"Cache-Control": cache})
        return web.FileResponse(index, headers={"Cache-Control": "no-cache"})

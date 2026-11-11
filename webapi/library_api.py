"""REST API бібліотеки користувача (/api/me/...) та історії відтворення (/api/history).

Mixin для ActivityServer: використовує його _identity, _context, _json, _body, _limit, _enqueue_for, library_event.
Усе вимагає сесії (у DEV_MODE — ?user=). Плейлисти й лайки бачить і змінює лише власник: Library перевіряє
user_id у кожному запиті, тож чужий плейлист для API просто «не знайдено».
"""

from __future__ import annotations

import asyncio
import logging
import random
import re
from typing import TYPE_CHECKING, Any

from aiohttp import web

from webapi.errors import ApiError
from webapi.library import MAX_LIKES, MAX_PLAYLIST_TRACKS, MAX_PLAYLISTS, Library, Owner
from youtube import Resolved, Track, YouTubeError, is_youtube_url

if TYPE_CHECKING:
    from webapi.auth import Identity

log = logging.getLogger(__name__)

VIDEO_ID_RE = re.compile(r"[\w-]{11}")
MAX_BATCH = 50  # скільки треків можна додати в плейлист одним запитом


class LibraryApi:
    def _add_library_routes(self, r: web.UrlDispatcher) -> None:
        r.add_get("/api/me", self.me)
        r.add_delete("/api/me", self.delete_me)
        r.add_get("/api/me/recent", self.recent_mine)
        r.add_get("/api/me/likes", self.likes)
        r.add_get("/api/me/likes/ids", self.like_ids)
        r.add_post("/api/me/likes/play", self.play_likes)
        r.add_put("/api/me/likes/{video_id}", self.like)
        r.add_delete("/api/me/likes/{video_id}", self.unlike)
        r.add_get("/api/me/playlists", self.list_playlists)
        r.add_post("/api/me/playlists", self.create_playlist)
        r.add_post("/api/me/playlists/import", self.import_playlist)
        r.add_get(r"/api/me/playlists/{pid:\d+}", self.get_playlist)
        r.add_patch(r"/api/me/playlists/{pid:\d+}", self.rename_playlist)
        r.add_delete(r"/api/me/playlists/{pid:\d+}", self.delete_playlist)
        r.add_post(r"/api/me/playlists/{pid:\d+}/tracks", self.add_to_playlist)
        r.add_delete(r"/api/me/playlists/{pid:\d+}/tracks/{entry:\d+}", self.remove_from_playlist)
        r.add_post(r"/api/me/playlists/{pid:\d+}/reorder", self.reorder_playlist)
        r.add_post(r"/api/me/playlists/{pid:\d+}/play", self.play_playlist)
        r.add_get("/api/history", self.history)

    # ---------- допоміжне ----------

    def _lib(self) -> Library:
        library = getattr(self.bot, "library", None)
        if library is None:
            raise ApiError(503, "Бібліотека тимчасово недоступна")
        return library

    def _owner(self, identity: Identity) -> Owner:
        name, avatar = identity.name, identity.avatar
        if identity.dev:  # у DEV_MODE імені з Discord-авторизації нема — беремо з кешу бота
            user = self.bot.get_user(identity.user_id)
            if user is not None:
                name = user.global_name or user.name
                avatar = user.display_avatar.with_size(64).url
        return Owner(identity.user_id, name, avatar)

    def _write_limit(self, identity: Identity, key: str = "library", count: int = 60, per: float = 60) -> None:
        self._limit(identity.user_id, key, count, per)

    @staticmethod
    def _video_id(raw: Any) -> str:
        video_id = str(raw or "")
        if not VIDEO_ID_RE.fullmatch(video_id):
            raise ApiError(400, "Неправильний id відео")
        return video_id

    async def _server_track(self, video_id: str) -> Track:
        """Метадані треку лише з серверних джерел (клієнту не віримо): пошук, черги плеєрів, БД, yt-dlp."""
        video_id = self._video_id(video_id)
        if (known := self.bot.yt.known(video_id)) is not None:
            return known
        for player in self.bot.players.all():
            for track in (player.current, *player.queue):
                if track is not None and track.id == video_id:
                    return track
        if (stored := await self._lib().track(video_id)) is not None:
            return stored
        try:
            resolved = await asyncio.wait_for(
                self.bot.yt.resolve(f"https://www.youtube.com/watch?v={video_id}"), timeout=25
            )
        except (YouTubeError, TimeoutError) as exc:
            raise ApiError(404, "Не вдалося знайти це відео на YouTube") from exc
        return resolved.tracks[0]

    async def _video_ids(self, body: dict[str, Any]) -> list[str]:
        raw = body.get("video_ids")
        if raw is None and body.get("video_id"):
            raw = [body["video_id"]]
        if not isinstance(raw, list) or not raw:
            raise ApiError(400, "Передай video_id або video_ids")
        if len(raw) > MAX_BATCH:
            raise ApiError(400, f"За раз можна додати до {MAX_BATCH} треків")
        return [self._video_id(v) for v in raw]

    @staticmethod
    def _int_param(request: web.Request, name: str) -> int:
        return int(request.match_info[name])

    async def _play_tracks(
        self, request: web.Request, body: dict[str, Any], tracks: list[Track], title: str
    ) -> web.Response:
        """Грати список (улюблені / плейлист): {guild, mode: queue|next|now, shuffle?, summon?}."""
        identity, guild, member = await self._context(request, body)
        self._limit(identity.user_id, "play", 8, 10)
        if not tracks:
            raise ApiError(409, "Тут поки нема треків")
        if body.get("shuffle"):
            tracks = random.sample(tracks, len(tracks))
        resolved = Resolved(tracks=tracks, playlist_title=title)
        return await self._enqueue_for(guild, member, resolved, body.get("mode", "queue"), bool(body.get("summon")))

    # ---------- профіль ----------

    async def me(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        library = getattr(self.bot, "library", None)
        profile = await library.profile(identity.user_id) if library else None
        owner = self._owner(identity)
        return self._json(
            {
                "id": str(identity.user_id),
                "name": profile["name"] if profile else owner.name,
                "avatar": profile["avatar"] if profile else owner.avatar,
                "dev": identity.dev,
                "library": library is not None,
                "created_at": profile["created_at"] if profile else None,
                "stats": profile["stats"]
                if profile
                else {"likes": 0, "playlists": 0, "playlist_tracks": 0, "plays": 0},
                "limits": {"playlists": MAX_PLAYLISTS, "playlist_tracks": MAX_PLAYLIST_TRACKS, "likes": MAX_LIKES},
            }
        )

    async def delete_me(self, request: web.Request) -> web.Response:
        """Видалити свої дані: профіль, лайки, плейлисти; в історії серверів прибрати своє ім'я."""
        identity = self._identity(request)
        self._write_limit(identity, "delete-me", 3, 60)
        deleted = await self._lib().delete_user(identity.user_id)
        self.library_event(identity.user_id, "deleted")
        log.info("Activity: користувач %s видалив свої дані: %s", identity.user_id, deleted)
        return self._json({"ok": True, "deleted": deleted})

    async def recent_mine(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        return self._json({"tracks": await self._lib().recent_for_user(identity.user_id)})

    # ---------- лайки ----------

    async def likes(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        tracks = await self._lib().likes(identity.user_id)
        return self._json({"tracks": tracks, "total": len(tracks)})

    async def like_ids(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        return self._json({"ids": await self._lib().liked_ids(identity.user_id)})

    async def like(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        self._write_limit(identity)
        track = await self._server_track(request.match_info["video_id"])
        added = await self._lib().like(self._owner(identity), track)
        self.library_event(identity.user_id, "likes", video_id=track.id, liked=True)
        return self._json({"ok": True, "liked": True, "added": added})

    async def unlike(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        self._write_limit(identity)
        video_id = self._video_id(request.match_info["video_id"])
        removed = await self._lib().unlike(identity.user_id, video_id)
        self.library_event(identity.user_id, "likes", video_id=video_id, liked=False)
        return self._json({"ok": True, "liked": False, "removed": removed})

    async def play_likes(self, request: web.Request) -> web.Response:
        body = await self._body(request)
        identity = self._identity(request)
        tracks = await self._lib().liked_tracks(identity.user_id)
        return await self._play_tracks(request, body, tracks, "Улюблені")

    # ---------- плейлисти ----------

    async def list_playlists(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        playlists = await self._lib().playlists(identity.user_id)
        return self._json({"playlists": playlists, "limit": MAX_PLAYLISTS})

    async def create_playlist(self, request: web.Request) -> web.Response:
        """{name, video_id?|video_ids?} — «+ У плейлист → Новий плейлист» створює одразу з треком."""
        body = await self._body(request)
        identity = self._identity(request)
        self._write_limit(identity)
        tracks: list[Track] = []
        if body.get("video_id") or body.get("video_ids"):
            tracks = [await self._server_track(v) for v in await self._video_ids(body)]
        playlist = await self._lib().create_playlist(self._owner(identity), body.get("name"), tracks)
        self.library_event(identity.user_id, "playlists", playlist_id=playlist["id"])
        return self._json({"ok": True, "playlist": playlist})

    async def import_playlist(self, request: web.Request) -> web.Response:
        """{url, name?} — YouTube-плейлист у новий плейлист (до 1000 треків)."""
        body = await self._body(request)
        identity = self._identity(request)
        self._write_limit(identity, "import", 5, 60)
        url = str(body.get("url") or "").strip()
        if not url or not is_youtube_url(url):
            raise ApiError(400, "Встав посилання на плейлист YouTube")
        try:
            resolved = await self.bot.yt.resolve(url, playlist_limit=MAX_PLAYLIST_TRACKS)
        except YouTubeError as exc:
            raise ApiError(400, str(exc)) from exc
        if not resolved.playlist_title:
            raise ApiError(400, "Це посилання не на плейлист. Потрібне посилання виду youtube.com/playlist?list=…")
        name = str(body.get("name") or "").strip() or resolved.playlist_title
        playlist = await self._lib().create_playlist(self._owner(identity), name, resolved.tracks)
        self.library_event(identity.user_id, "playlists", playlist_id=playlist["id"])
        return self._json({"ok": True, "playlist": playlist, "imported": playlist["track_count"]})

    async def get_playlist(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        return self._json(await self._lib().playlist(identity.user_id, self._int_param(request, "pid")))

    async def rename_playlist(self, request: web.Request) -> web.Response:
        body = await self._body(request)
        identity = self._identity(request)
        self._write_limit(identity)
        pid = self._int_param(request, "pid")
        await self._lib().rename_playlist(identity.user_id, pid, body.get("name"))
        self.library_event(identity.user_id, "playlists", playlist_id=pid)
        return self._json({"ok": True})

    async def delete_playlist(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        self._write_limit(identity)
        pid = self._int_param(request, "pid")
        await self._lib().delete_playlist(identity.user_id, pid)
        self.library_event(identity.user_id, "playlists", playlist_id=pid, deleted=True)
        return self._json({"ok": True})

    async def add_to_playlist(self, request: web.Request) -> web.Response:
        body = await self._body(request)
        identity = self._identity(request)
        self._write_limit(identity)
        pid = self._int_param(request, "pid")
        await self._lib().playlist(identity.user_id, pid)  # власник — до того, як ходити в YouTube
        tracks = [await self._server_track(v) for v in await self._video_ids(body)]
        added = await self._lib().add_tracks(identity.user_id, pid, tracks)
        self.library_event(identity.user_id, "playlists", playlist_id=pid)
        return self._json({"ok": True, "added": added, "skipped": len(tracks) - added})

    async def remove_from_playlist(self, request: web.Request) -> web.Response:
        identity = self._identity(request)
        self._write_limit(identity)
        pid = self._int_param(request, "pid")
        await self._lib().remove_entry(identity.user_id, pid, self._int_param(request, "entry"))
        self.library_event(identity.user_id, "playlists", playlist_id=pid)
        return self._json({"ok": True})

    async def reorder_playlist(self, request: web.Request) -> web.Response:
        """{entry_id, to} — перетягування: запис стає на позицію to (з 0)."""
        body = await self._body(request)
        identity = self._identity(request)
        self._write_limit(identity)
        pid = self._int_param(request, "pid")
        await self._lib().move_entry(identity.user_id, pid, self._int(body, "entry_id"), self._int(body, "to"))
        self.library_event(identity.user_id, "playlists", playlist_id=pid)
        return self._json({"ok": True})

    async def play_playlist(self, request: web.Request) -> web.Response:
        body = await self._body(request)
        identity = self._identity(request)
        name, tracks = await self._lib().playlist_tracks(identity.user_id, self._int_param(request, "pid"))
        return await self._play_tracks(request, body, tracks, name)

    # ---------- історія сервера ----------

    async def history(self, request: web.Request) -> web.Response:
        """Нещодавно на сервері (бачить будь-хто з сервера)."""
        _, guild, _member = await self._context(request)
        rows = await self._lib().recent_in_guild(guild.id)
        for row in rows:
            requester_id = row.pop("requester_id")
            member = guild.get_member(int(requester_id)) if requester_id else None
            row["requester"] = (
                {"id": str(member.id), "name": member.display_name, "avatar": member.display_avatar.with_size(64).url}
                if member
                else None
            )
        return self._json({"tracks": rows})

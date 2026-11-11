"""Бібліотека користувачів Activity: профілі, лайки, плейлисти й історія відтворення (SQLite через aiosqlite).

- Акаунт = Discord-користувач; профіль створюється при першому вході в Activity.
- Трек зберігається як метадані (video_id, назва, канал, тривалість, обкладинка) — без медіа. Метадані беруться
  лише з серверних джерел (пошук, черга, yt-dlp), не від клієнта, тому таблиця tracks спільна для всіх.
- Плейлисти й лайки приватні: кожен запит до плейлиста перевіряє власника (чужий = «не знайдено»).
- Одне з'єднання на весь бот. Записи йдуть у транзакціях під asyncio.Lock: два корутини на одному
  з'єднанні інакше перемішали б свої транзакції. Схема версіонується таблицею schema_version (MIGRATIONS).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiosqlite

from youtube import Track

log = logging.getLogger(__name__)

MAX_PLAYLISTS = 100
MAX_PLAYLIST_TRACKS = 1000
MAX_LIKES = 5000
MAX_NAME = 100
HISTORY_PER_GUILD = 300  # скільки останніх відтворень тримати на сервер

# (версія, інструкції). Нову міграцію — лише ДОПИСУВАТИ в кінець; уже застосовані не змінювати.
MIGRATIONS: list[tuple[int, list[str]]] = [
    (
        1,
        [
            """CREATE TABLE users (
                id INTEGER PRIMARY KEY,               -- Discord user id
                name TEXT NOT NULL,
                avatar TEXT,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL
            )""",
            """CREATE TABLE tracks (
                video_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                channel TEXT,
                duration INTEGER,
                thumbnail TEXT,
                updated_at INTEGER NOT NULL
            )""",
            """CREATE TABLE likes (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                video_id TEXT NOT NULL REFERENCES tracks(video_id),
                created_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, video_id)
            )""",
            "CREATE INDEX likes_by_user ON likes(user_id, created_at DESC)",
            """CREATE TABLE playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )""",
            "CREATE INDEX playlists_by_user ON playlists(user_id, updated_at DESC)",
            """CREATE TABLE playlist_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,  -- id запису: той самий трек може стояти двічі
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                video_id TEXT NOT NULL REFERENCES tracks(video_id),
                position INTEGER NOT NULL,
                added_at INTEGER NOT NULL
            )""",
            "CREATE INDEX playlist_tracks_order ON playlist_tracks(playlist_id, position)",
            """CREATE TABLE play_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id INTEGER NOT NULL,
                video_id TEXT NOT NULL REFERENCES tracks(video_id),
                requester_id INTEGER,                  -- NULL після видалення акаунта
                played_at INTEGER NOT NULL
            )""",
            "CREATE INDEX play_history_by_guild ON play_history(guild_id, id DESC)",
            "CREATE INDEX play_history_by_requester ON play_history(requester_id, id DESC)",
        ],
    ),
]
SCHEMA_VERSION = MIGRATIONS[-1][0]


class LibraryError(Exception):
    """Помилка з HTTP-статусом і текстом для користувача."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True, slots=True)
class Owner:
    """Хто виконує дію (для автоматичного створення профілю)."""

    id: int
    name: str
    avatar: str | None = None


def _now() -> int:
    return int(time.time())


def _clean_name(name: Any) -> str:
    text = " ".join(str(name or "").split())
    if not text:
        raise LibraryError(400, "Назва плейлиста не може бути порожньою")
    return text[:MAX_NAME]


def _track_json(row: aiosqlite.Row | dict[str, Any], key: str) -> dict[str, Any]:
    """Трек у тому ж форматі, що й у стані плеєра (webapi/state.py), щоб фронтенд малював їх однаково."""
    video_id = row["video_id"]
    return {
        "id": video_id,
        "key": key,
        "title": row["title"],
        "channel": row["channel"],
        "duration": row["duration"],
        "is_live": False,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "thumbnail": row["thumbnail"] or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "thumbnail_small": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
        "requester": None,
    }


def _to_track(row: aiosqlite.Row) -> Track:
    return Track(
        id=row["video_id"],
        title=row["title"],
        duration=row["duration"],
        channel=row["channel"],
        thumbnail=row["thumbnail"],
    )


class Library:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._db: aiosqlite.Connection | None = None
        self._write = asyncio.Lock()

    # ---------- з'єднання і міграції ----------

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise LibraryError(503, "Бібліотека недоступна")
        return self._db

    async def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # isolation_level=None: транзакції відкриваємо самі (BEGIN IMMEDIATE у _tx).
        db = await aiosqlite.connect(self.path, isolation_level=None)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute("PRAGMA busy_timeout=5000")
        self._db = db
        try:
            await self._migrate()
        except BaseException:
            await self.close()
            raise

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    @contextlib.asynccontextmanager
    async def _tx(self) -> AsyncIterator[aiosqlite.Connection]:
        db = self.db
        async with self._write:
            await db.execute("BEGIN IMMEDIATE")
            try:
                yield db
            except BaseException:
                await db.execute("ROLLBACK")
                raise
            await db.execute("COMMIT")

    async def schema_version(self) -> int:
        await self.db.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        async with self.db.execute("SELECT MAX(version) FROM schema_version") as cur:
            row = await cur.fetchone()
        return int(row[0]) if row and row[0] is not None else 0

    async def _migrate(self) -> None:
        current = await self.schema_version()
        for version, statements in MIGRATIONS:
            if version <= current:
                continue
            async with self._tx() as db:
                for statement in statements:
                    await db.execute(statement)
                await db.execute("DELETE FROM schema_version")
                await db.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
            log.info("БД: схему оновлено до версії %d (%s)", version, self.path.name)

    # ---------- службове ----------

    @staticmethod
    async def _ensure_user(db: aiosqlite.Connection, owner: Owner) -> None:
        now = _now()
        await db.execute(
            "INSERT OR IGNORE INTO users (id, name, avatar, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
            (owner.id, owner.name[:100], owner.avatar, now, now),
        )

    @staticmethod
    async def _upsert_track(db: aiosqlite.Connection, track: Track) -> None:
        await db.execute(
            """INSERT INTO tracks (video_id, title, channel, duration, thumbnail, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(video_id) DO UPDATE SET
                 title = excluded.title,
                 channel = COALESCE(excluded.channel, tracks.channel),
                 duration = COALESCE(excluded.duration, tracks.duration),
                 thumbnail = COALESCE(excluded.thumbnail, tracks.thumbnail),
                 updated_at = excluded.updated_at""",
            (
                track.id,
                track.title[:300],
                (track.channel or None) and track.channel[:200],
                None if track.is_live else track.duration,
                track.thumbnail,
                _now(),
            ),
        )

    @staticmethod
    async def _owned_playlist(db: aiosqlite.Connection, user_id: int, playlist_id: int) -> aiosqlite.Row:
        async with db.execute(
            "SELECT id, name, created_at, updated_at FROM playlists WHERE id = ? AND user_id = ?",
            (playlist_id, user_id),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            raise LibraryError(404, "Плейлист не знайдено")
        return row

    @staticmethod
    async def _touch_playlist(db: aiosqlite.Connection, playlist_id: int) -> None:
        await db.execute("UPDATE playlists SET updated_at = ? WHERE id = ?", (_now(), playlist_id))

    @staticmethod
    async def _prune_tracks(db: aiosqlite.Connection) -> None:
        """Метадані треків, на які вже ніщо не посилається."""
        await db.execute(
            """DELETE FROM tracks WHERE video_id NOT IN (
                 SELECT video_id FROM likes UNION SELECT video_id FROM playlist_tracks
                 UNION SELECT video_id FROM play_history)"""
        )

    # ---------- профіль ----------

    async def touch_user(self, owner: Owner) -> None:
        """Вхід в Activity: створити профіль або оновити ім'я, аватар і час останнього входу."""
        now = _now()
        async with self._tx() as db:
            await db.execute(
                """INSERT INTO users (id, name, avatar, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar,
                     last_seen_at = excluded.last_seen_at""",
                (owner.id, owner.name[:100], owner.avatar, now, now),
            )

    async def profile(self, user_id: int) -> dict[str, Any] | None:
        async with self.db.execute(
            """SELECT u.id, u.name, u.avatar, u.created_at, u.last_seen_at,
                 (SELECT COUNT(*) FROM likes WHERE user_id = u.id) AS likes,
                 (SELECT COUNT(*) FROM playlists WHERE user_id = u.id) AS playlists,
                 (SELECT COUNT(*) FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
                    WHERE p.user_id = u.id) AS playlist_tracks,
                 (SELECT COUNT(*) FROM play_history WHERE requester_id = u.id) AS plays
               FROM users u WHERE u.id = ?""",
            (user_id,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "avatar": row["avatar"],
            "created_at": row["created_at"],
            "last_seen_at": row["last_seen_at"],
            "stats": {
                "likes": row["likes"],
                "playlists": row["playlists"],
                "playlist_tracks": row["playlist_tracks"],
                "plays": row["plays"],
            },
        }

    async def delete_user(self, user_id: int) -> dict[str, int]:
        """Видалити профіль, лайки й плейлисти; в історії сервера прибрати, хто замовляв."""
        async with self._tx() as db:
            counts: dict[str, int] = {}
            for key, sql in (
                ("likes", "SELECT COUNT(*) FROM likes WHERE user_id = ?"),
                ("playlists", "SELECT COUNT(*) FROM playlists WHERE user_id = ?"),
            ):
                async with db.execute(sql, (user_id,)) as cur:
                    counts[key] = (await cur.fetchone())[0]  # type: ignore[index]
            async with db.execute("DELETE FROM users WHERE id = ?", (user_id,)) as cur:
                counts["profile"] = cur.rowcount
            async with db.execute(
                "UPDATE play_history SET requester_id = NULL WHERE requester_id = ?", (user_id,)
            ) as cur:
                counts["history_anonymized"] = cur.rowcount
            await self._prune_tracks(db)
        return counts

    # ---------- метадані треків ----------

    async def track(self, video_id: str) -> Track | None:
        async with self.db.execute("SELECT * FROM tracks WHERE video_id = ?", (video_id,)) as cur:
            row = await cur.fetchone()
        return _to_track(row) if row else None

    # ---------- лайки ----------

    async def liked_ids(self, user_id: int) -> list[str]:
        async with self.db.execute(
            "SELECT video_id FROM likes WHERE user_id = ? ORDER BY created_at DESC, rowid DESC", (user_id,)
        ) as cur:
            return [row[0] for row in await cur.fetchall()]

    async def is_liked(self, user_id: int, video_id: str) -> bool:
        async with self.db.execute(
            "SELECT 1 FROM likes WHERE user_id = ? AND video_id = ?", (user_id, video_id)
        ) as cur:
            return await cur.fetchone() is not None

    async def likes(self, user_id: int) -> list[dict[str, Any]]:
        async with self.db.execute(
            """SELECT t.*, l.created_at AS liked_at FROM likes l JOIN tracks t ON t.video_id = l.video_id
               WHERE l.user_id = ? ORDER BY l.created_at DESC, l.rowid DESC""",
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
        return [{**_track_json(row, f"like-{row['video_id']}"), "liked_at": row["liked_at"]} for row in rows]

    async def liked_tracks(self, user_id: int) -> list[Track]:
        async with self.db.execute(
            """SELECT t.* FROM likes l JOIN tracks t ON t.video_id = l.video_id
               WHERE l.user_id = ? ORDER BY l.created_at DESC, l.rowid DESC""",
            (user_id,),
        ) as cur:
            return [_to_track(row) for row in await cur.fetchall()]

    async def like(self, owner: Owner, track: Track) -> bool:
        """True — додано; False — вже було в улюблених."""
        async with self._tx() as db:
            await self._ensure_user(db, owner)
            async with db.execute(
                "SELECT 1 FROM likes WHERE user_id = ? AND video_id = ?", (owner.id, track.id)
            ) as cur:
                if await cur.fetchone():
                    return False
            async with db.execute("SELECT COUNT(*) FROM likes WHERE user_id = ?", (owner.id,)) as cur:
                if (await cur.fetchone())[0] >= MAX_LIKES:  # type: ignore[index]
                    raise LibraryError(409, f"В «Улюблених» уже {MAX_LIKES} треків — прибери щось")
            await self._upsert_track(db, track)
            await db.execute(
                "INSERT INTO likes (user_id, video_id, created_at) VALUES (?, ?, ?)", (owner.id, track.id, _now())
            )
            return True

    async def unlike(self, user_id: int, video_id: str) -> bool:
        async with self._tx() as db:
            async with db.execute("DELETE FROM likes WHERE user_id = ? AND video_id = ?", (user_id, video_id)) as cur:
                removed = cur.rowcount > 0
            if removed:
                await self._prune_tracks(db)
            return removed

    async def toggle_like(self, owner: Owner, track: Track) -> bool:
        """Кнопка ❤ на панелі в Discord. Повертає новий стан."""
        if await self.is_liked(owner.id, track.id):
            await self.unlike(owner.id, track.id)
            return False
        await self.like(owner, track)
        return True

    # ---------- плейлисти ----------

    async def playlists(self, user_id: int) -> list[dict[str, Any]]:
        async with self.db.execute(
            """SELECT p.id, p.name, p.created_at, p.updated_at,
                 COUNT(pt.id) AS track_count, COALESCE(SUM(t.duration), 0) AS duration
               FROM playlists p
               LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
               LEFT JOIN tracks t ON t.video_id = pt.video_id
               WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC""",
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
        covers = await self._covers([row["id"] for row in rows])
        return [
            {
                "id": row["id"],
                "name": row["name"],
                "track_count": row["track_count"],
                "duration": row["duration"],
                "cover": covers.get(row["id"], []),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    async def _covers(self, playlist_ids: list[int]) -> dict[int, list[str]]:
        """Обкладинка плейлиста = 4 перші різні треки (колаж)."""
        if not playlist_ids:
            return {}
        marks = ",".join("?" * len(playlist_ids))
        async with self.db.execute(
            f"""SELECT playlist_id, video_id FROM playlist_tracks
                WHERE playlist_id IN ({marks}) AND position < 24 ORDER BY playlist_id, position""",
            playlist_ids,
        ) as cur:
            rows = await cur.fetchall()
        covers: dict[int, list[str]] = {}
        for row in rows:
            items = covers.setdefault(row["playlist_id"], [])
            url = f"https://i.ytimg.com/vi/{row['video_id']}/mqdefault.jpg"
            if len(items) < 4 and url not in items:
                items.append(url)
        return covers

    async def create_playlist(self, owner: Owner, name: Any, tracks: list[Track] | None = None) -> dict[str, Any]:
        clean = _clean_name(name)
        now = _now()
        async with self._tx() as db:
            await self._ensure_user(db, owner)
            async with db.execute("SELECT COUNT(*) FROM playlists WHERE user_id = ?", (owner.id,)) as cur:
                if (await cur.fetchone())[0] >= MAX_PLAYLISTS:  # type: ignore[index]
                    raise LibraryError(409, f"У тебе вже {MAX_PLAYLISTS} плейлистів — видали якийсь")
            async with db.execute(
                "INSERT INTO playlists (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (owner.id, clean, now, now),
            ) as cur:
                playlist_id = int(cur.lastrowid or 0)
            for position, track in enumerate((tracks or [])[:MAX_PLAYLIST_TRACKS]):
                await self._upsert_track(db, track)
                await db.execute(
                    "INSERT INTO playlist_tracks (playlist_id, video_id, position, added_at) VALUES (?, ?, ?, ?)",
                    (playlist_id, track.id, position, now),
                )
        return await self.playlist(owner.id, playlist_id)

    async def rename_playlist(self, user_id: int, playlist_id: int, name: Any) -> None:
        clean = _clean_name(name)
        async with self._tx() as db:
            await self._owned_playlist(db, user_id, playlist_id)
            await db.execute("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?", (clean, _now(), playlist_id))

    async def delete_playlist(self, user_id: int, playlist_id: int) -> None:
        async with self._tx() as db:
            await self._owned_playlist(db, user_id, playlist_id)
            await db.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
            await self._prune_tracks(db)

    async def playlist(self, user_id: int, playlist_id: int) -> dict[str, Any]:
        head = await self._owned_playlist(self.db, user_id, playlist_id)
        async with self.db.execute(
            """SELECT pt.id AS entry_id, pt.position, pt.added_at, t.* FROM playlist_tracks pt
               JOIN tracks t ON t.video_id = pt.video_id
               WHERE pt.playlist_id = ? ORDER BY pt.position""",
            (playlist_id,),
        ) as cur:
            rows = await cur.fetchall()
        tracks = [
            {**_track_json(row, f"entry-{row['entry_id']}"), "entry_id": row["entry_id"], "added_at": row["added_at"]}
            for row in rows
        ]
        covers = await self._covers([playlist_id])
        return {
            "id": head["id"],
            "name": head["name"],
            "created_at": head["created_at"],
            "updated_at": head["updated_at"],
            "track_count": len(tracks),
            "duration": sum(t["duration"] or 0 for t in tracks),
            "cover": covers.get(playlist_id, []),
            "tracks": tracks,
        }

    async def playlist_tracks(self, user_id: int, playlist_id: int) -> tuple[str, list[Track]]:
        head = await self._owned_playlist(self.db, user_id, playlist_id)
        async with self.db.execute(
            """SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.video_id = pt.video_id
               WHERE pt.playlist_id = ? ORDER BY pt.position""",
            (playlist_id,),
        ) as cur:
            return head["name"], [_to_track(row) for row in await cur.fetchall()]

    async def add_tracks(self, user_id: int, playlist_id: int, tracks: list[Track]) -> int:
        """Додає в кінець. Повертає, скільки реально додано (решта — понад ліміт)."""
        async with self._tx() as db:
            await self._owned_playlist(db, user_id, playlist_id)
            async with db.execute(
                "SELECT COUNT(*), COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?",
                (playlist_id,),
            ) as cur:
                count, last = await cur.fetchone()  # type: ignore[misc]
            room = MAX_PLAYLIST_TRACKS - count
            if room <= 0:
                raise LibraryError(409, f"У плейлисті вже {MAX_PLAYLIST_TRACKS} треків")
            now = _now()
            for offset, track in enumerate(tracks[:room], start=1):
                await self._upsert_track(db, track)
                await db.execute(
                    "INSERT INTO playlist_tracks (playlist_id, video_id, position, added_at) VALUES (?, ?, ?, ?)",
                    (playlist_id, track.id, last + offset, now),
                )
            await self._touch_playlist(db, playlist_id)
            return min(len(tracks), room)

    async def remove_entry(self, user_id: int, playlist_id: int, entry_id: int) -> None:
        async with self._tx() as db:
            await self._owned_playlist(db, user_id, playlist_id)
            async with db.execute(
                "SELECT position FROM playlist_tracks WHERE id = ? AND playlist_id = ?", (entry_id, playlist_id)
            ) as cur:
                row = await cur.fetchone()
            if row is None:
                raise LibraryError(404, "Цього треку вже нема в плейлисті")
            await db.execute("DELETE FROM playlist_tracks WHERE id = ?", (entry_id,))
            await db.execute(
                "UPDATE playlist_tracks SET position = position - 1 WHERE playlist_id = ? AND position > ?",
                (playlist_id, row["position"]),
            )
            await self._touch_playlist(db, playlist_id)
            await self._prune_tracks(db)

    async def move_entry(self, user_id: int, playlist_id: int, entry_id: int, to_index: int) -> None:
        """Перетягування: запис entry_id стає на позицію to_index (з 0), решта зсуваються."""
        async with self._tx() as db:
            await self._owned_playlist(db, user_id, playlist_id)
            async with db.execute(
                "SELECT position FROM playlist_tracks WHERE id = ? AND playlist_id = ?", (entry_id, playlist_id)
            ) as cur:
                row = await cur.fetchone()
            if row is None:
                raise LibraryError(404, "Цього треку вже нема в плейлисті")
            async with db.execute("SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,)) as cur:
                count = (await cur.fetchone())[0]  # type: ignore[index]
            source, target = row["position"], max(0, min(int(to_index), count - 1))
            if source == target:
                return
            if target > source:
                await db.execute(
                    """UPDATE playlist_tracks SET position = position - 1
                       WHERE playlist_id = ? AND position > ? AND position <= ?""",
                    (playlist_id, source, target),
                )
            else:
                await db.execute(
                    """UPDATE playlist_tracks SET position = position + 1
                       WHERE playlist_id = ? AND position >= ? AND position < ?""",
                    (playlist_id, target, source),
                )
            await db.execute("UPDATE playlist_tracks SET position = ? WHERE id = ?", (target, entry_id))
            await self._touch_playlist(db, playlist_id)

    # ---------- історія ----------

    async def record_play(self, guild_id: int, track: Track) -> None:
        """Трек почав грати: для «Нещодавно на сервері» і «Продовжити слухати»."""
        async with self._tx() as db:
            await self._upsert_track(db, track)
            await db.execute(
                "INSERT INTO play_history (guild_id, video_id, requester_id, played_at) VALUES (?, ?, ?, ?)",
                (guild_id, track.id, track.requester_id, _now()),
            )
            await db.execute(
                """DELETE FROM play_history WHERE guild_id = ? AND id NOT IN (
                     SELECT id FROM play_history WHERE guild_id = ? ORDER BY id DESC LIMIT ?)""",
                (guild_id, guild_id, HISTORY_PER_GUILD),
            )

    async def recent_in_guild(self, guild_id: int, limit: int = 30) -> list[dict[str, Any]]:
        async with self.db.execute(
            """SELECT t.*, h.requester_id, h.played_at FROM play_history h
               JOIN tracks t ON t.video_id = h.video_id
               WHERE h.id IN (SELECT MAX(id) FROM play_history WHERE guild_id = ? GROUP BY video_id)
               ORDER BY h.id DESC LIMIT ?""",
            (guild_id, limit),
        ) as cur:
            rows = await cur.fetchall()
        return [
            {
                **_track_json(row, f"recent-{row['video_id']}"),
                "requester_id": str(row["requester_id"]) if row["requester_id"] else None,
                "played_at": row["played_at"],
            }
            for row in rows
        ]

    async def recent_for_user(self, user_id: int, limit: int = 20) -> list[dict[str, Any]]:
        """«Продовжити слухати»: останні треки, які замовляв цей користувач (на будь-якому сервері)."""
        async with self.db.execute(
            """SELECT t.*, h.played_at FROM play_history h JOIN tracks t ON t.video_id = h.video_id
               WHERE h.id IN (SELECT MAX(id) FROM play_history WHERE requester_id = ? GROUP BY video_id)
               ORDER BY h.id DESC LIMIT ?""",
            (user_id, limit),
        ) as cur:
            rows = await cur.fetchall()
        return [{**_track_json(row, f"mine-{row['video_id']}"), "played_at": row["played_at"]} for row in rows]

"""YouTube: пошук, розбір посилань і витягування прямого аудіо-URL через yt-dlp.

yt-dlp синхронний, тому всі виклики йдуть у окремий ThreadPoolExecutor.
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import re
import shutil
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

import yt_dlp
from yt_dlp.utils import DownloadError

from config import BASE_DIR, COOKIES_FILE

log = logging.getLogger(__name__)

SEARCH_SIZE = 20  # завжди шукаємо 20 (стільки ж часу, що й 10): кеш підходить автокомпліту, /search і Activity
SEARCH_CACHE_TTL = 15 * 60
SEARCH_CACHE_MAX = 300
PLAYLIST_LIMIT = 500

_YOUTUBE_HOSTS = {"youtube.com", "youtu.be", "youtube-nocookie.com"}
_URL_RE = re.compile(r"^(https?://)?([\w-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)/", re.I)
_VIDEO_ID_RE = re.compile(r"^[\w-]{11}$")
_HIDDEN_TITLES = {"[Private video]", "[Deleted video]", "[Unavailable video]"}
_COOKIES_RUNTIME_DIR = BASE_DIR / "data" / "cookies"


class YouTubeError(Exception):
    """Помилка, текст якої можна показати користувачу."""


@dataclass(slots=True)
class Track:
    id: str
    title: str
    duration: int | None  # секунди; None — невідомо або стрім
    channel: str | None
    thumbnail: str | None = None
    is_live: bool = False
    requester_id: int | None = None

    @property
    def url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.id}"

    @property
    def thumb_small(self) -> str:
        # mqdefault: 16:9 без чорних смуг — і для мініатюр, і для обчислення кольору.
        return f"https://i.ytimg.com/vi/{self.id}/mqdefault.jpg"

    @property
    def thumb_large(self) -> str:
        return self.thumbnail or f"https://i.ytimg.com/vi/{self.id}/hqdefault.jpg"

    def for_requester(self, user_id: int) -> Track:
        return dataclasses.replace(self, requester_id=user_id)


@dataclass(slots=True)
class Resolved:
    tracks: list[Track]
    playlist_title: str | None = None
    playlist_url: str | None = None


@dataclass(slots=True)
class Stream:
    url: str
    duration: int | None
    is_live: bool
    thumbnail: str | None
    fetched_at: float  # time.monotonic()
    # YouTube віддає аудіо тільки після «передролу» (~5 с): до цього моменту googlevideo
    # відповідає 403. yt-dlp при завантаженні сам чекає; ми стрімимо, тож чекаємо самі.
    available_at: float = 0.0  # time.time()

    def wait_seconds(self) -> float:
        return max(0.0, self.available_at - time.time())


def looks_like_url(text: str) -> bool:
    text = text.strip()
    return text.lower().startswith(("http://", "https://")) or bool(_URL_RE.match(text))


def is_youtube_url(text: str) -> bool:
    text = text.strip()
    if not text.lower().startswith(("http://", "https://")):
        text = "https://" + text
    host = (urlparse(text).hostname or "").lower()
    for prefix in ("www.", "m.", "music."):
        host = host.removeprefix(prefix)
    return host in _YOUTUBE_HOSTS


def video_id_from_url(url: str) -> str | None:
    """ID відео з простого посилання (watch?v=, youtu.be/, shorts/), інакше None."""
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    candidate: str | None = None
    if host.endswith("youtu.be"):
        candidate = parsed.path.strip("/").split("/")[0]
    elif parsed.path == "/watch":
        candidate = parse_qs(parsed.query).get("v", [None])[0]
    elif parsed.path.startswith(("/shorts/", "/live/")):
        candidate = parsed.path.split("/")[2]
    return candidate if candidate and _VIDEO_ID_RE.match(candidate) else None


def _normalize_query(query: str) -> str:
    return " ".join(query.lower().split())


class _YtdlLogger:
    """Перенаправляє вивід yt-dlp у logging (а не в stdout)."""

    _log = logging.getLogger("yt_dlp")

    def debug(self, msg: str) -> None:
        self._log.debug(msg)

    def info(self, msg: str) -> None:
        self._log.debug(msg)

    def warning(self, msg: str) -> None:
        self._log.warning(msg)

    def error(self, msg: str) -> None:
        self._log.debug(msg)  # помилки й так прилетять як DownloadError


def _cookie_file_for_thread() -> str | None:
    """yt-dlp перезаписує cookiefile при закритті. Щоб паралельні потоки не зіпсували
    оригінальний cookies.txt, кожен потік працює зі своєю копією."""
    if not COOKIES_FILE.is_file():
        return None
    _COOKIES_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    target = _COOKIES_RUNTIME_DIR / f"{threading.current_thread().name}.txt"
    shutil.copyfile(COOKIES_FILE, target)
    return str(target)


def _options(**extra: Any) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 10,
        "extractor_retries": 2,
        # IPv4: з IPv6 YouTube частіше показує капчу/403.
        "source_address": "0.0.0.0",
        # JS-челенджі YouTube: використає Deno або Node.js, що знайде.
        "js_runtimes": {"deno": {}, "node": {}},
        "logger": _YtdlLogger(),
    }
    if cookiefile := _cookie_file_for_thread():
        opts["cookiefile"] = cookiefile
    opts.update(extra)
    return opts


def _friendly_error(exc: Exception) -> YouTubeError:
    text = str(exc)
    low = text.lower()
    if "sign in to confirm" in low or "not a bot" in low:
        msg = "YouTube просить підтвердити, що це не бот. Поклади `cookies.txt` поруч із ботом (див. README)."
    elif "age" in low and ("restricted" in low or "confirm your age" in low):
        msg = "Відео з віковим обмеженням — потрібен `cookies.txt` з акаунта 18+."
    elif "private video" in low:
        msg = "Це приватне відео."
    elif "members-only" in low or "join this channel" in low:
        msg = "Відео тільки для спонсорів каналу."
    elif "video unavailable" in low or "not available" in low:
        msg = "Відео недоступне (видалене або заблоковане в регіоні)."
    elif "premieres in" in low or "live event will begin" in low:
        msg = "Прем'єра/трансляція ще не почалась."
    else:
        msg = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]{11}:\s*)?", "", text).strip()
        msg = msg[:300] or "Невідома помилка yt-dlp."
    return YouTubeError(msg)


def _thumbnail_exists(url: str) -> bool:
    """yt-dlp перелічує maxresdefault і для старих відео, де його нема; тоді i.ytimg.com віддає 404
    з картинкою-заглушкою (сірий прямокутник), яку браузер і Discord показали б як «обкладинку»."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=3) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False


def _best_thumbnail(info: dict[str, Any]) -> str | None:
    """Найкраща JPG-мініатюра, що реально існує (webp Discord теж показує, але JPG надійніший).

    Викликається лише в потоках yt-dlp (не в event loop), тож короткі HEAD-перевірки тут дозволені.
    """
    thumbs = info.get("thumbnails") or []
    candidates = [
        url
        for thumb in reversed(thumbs)  # yt-dlp сортує за зростанням якості
        if (url := thumb.get("url") or "").endswith(".jpg") and "vi_webp" not in url
    ]
    for url in candidates[:3]:
        if _thumbnail_exists(url):
            return url
    video_id = info.get("id")
    if isinstance(video_id, str) and _VIDEO_ID_RE.match(video_id):
        return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"  # є завжди
    return info.get("thumbnail")


def _track_from_entry(entry: dict[str, Any] | None) -> Track | None:
    if not entry:
        return None
    video_id = entry.get("id") or ""
    if entry.get("ie_key") not in (None, "Youtube") or not _VIDEO_ID_RE.match(video_id):
        return None
    title = entry.get("title") or video_id
    if title in _HIDDEN_TITLES:
        return None
    duration = entry.get("duration")
    live = entry.get("live_status") == "is_live" or bool(entry.get("is_live"))
    return Track(
        id=video_id,
        title=title,
        duration=int(duration) if duration and not live else None,
        channel=entry.get("channel") or entry.get("uploader"),
        is_live=live,
    )


class YouTube:
    def __init__(self, workers: int = 4) -> None:
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ytdl")
        self._cache: OrderedDict[str, tuple[float, list[Track]]] = OrderedDict()
        self._inflight: dict[str, asyncio.Future[list[Track]]] = {}
        # Треки з недавніх пошуків: посилання з автокомпліту не треба витягувати вдруге.
        self._known: OrderedDict[str, Track] = OrderedDict()

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    async def _run[T](self, func: Any, *args: Any) -> T:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._pool, func, *args)

    # ---------- пошук ----------

    def cached_search(self, query: str) -> list[Track] | None:
        key = _normalize_query(query)
        hit = self._cache.get(key)
        if hit is None:
            return None
        stamp, tracks = hit
        if time.monotonic() - stamp > SEARCH_CACHE_TTL:
            self._cache.pop(key, None)
            return None
        self._cache.move_to_end(key)
        return tracks

    def _remember(self, key: str, tracks: list[Track]) -> None:
        self._cache[key] = (time.monotonic(), tracks)
        self._cache.move_to_end(key)
        while len(self._cache) > SEARCH_CACHE_MAX:
            self._cache.popitem(last=False)
        for track in tracks:
            self._known[track.id] = track
            self._known.move_to_end(track.id)
        while len(self._known) > SEARCH_CACHE_MAX * SEARCH_SIZE:
            self._known.popitem(last=False)

    async def search(self, query: str, limit: int = SEARCH_SIZE) -> list[Track]:
        """Пошук з кешем; однакові запити, що летять одночасно, виконуються один раз."""
        key = _normalize_query(query)
        if not key:
            return []
        if (cached := self.cached_search(key)) is not None:
            return cached[:limit]

        future = self._inflight.get(key)
        if future is None:
            loop = asyncio.get_running_loop()
            future = loop.run_in_executor(self._pool, self._search_sync, key)
            self._inflight[key] = future

            def _done(fut: asyncio.Future[list[Track]], key: str = key) -> None:
                self._inflight.pop(key, None)
                if not fut.cancelled() and fut.exception() is None:
                    self._remember(key, fut.result())

            future.add_done_callback(_done)

        # shield: якщо автокомпліт перестане чекати, пошук усе одно доповнить кеш.
        tracks = await asyncio.shield(future)
        return tracks[:limit]

    def _search_sync(self, query: str) -> list[Track]:
        started = time.perf_counter()
        try:
            with yt_dlp.YoutubeDL(_options(extract_flat=True)) as ydl:
                info = ydl.extract_info(f"ytsearch{SEARCH_SIZE}:{query}", download=False)
        except DownloadError as exc:
            raise _friendly_error(exc) from exc
        tracks = [t for e in (info or {}).get("entries") or [] if (t := _track_from_entry(e))]
        log.debug("Пошук %r: %d рез. за %.2fс", query, len(tracks), time.perf_counter() - started)
        return tracks

    # ---------- посилання ----------

    async def resolve(self, query: str) -> Resolved:
        """Посилання на відео/плейлист або текстовий запит (перший результат пошуку)."""
        query = query.strip()
        if looks_like_url(query):
            if not is_youtube_url(query):
                raise YouTubeError("Підтримується тільки YouTube.")
            if not query.lower().startswith(("http://", "https://")):
                query = "https://" + query
            video_id = video_id_from_url(query)
            if video_id and (known := self._known.get(video_id)) is not None:
                return Resolved(tracks=[known])
            return await self._run(self._resolve_url_sync, query)

        results = await self.search(query, limit=1)
        if not results:
            raise YouTubeError(f"Нічого не знайшов за запитом «{query[:80]}».")
        return Resolved(tracks=[results[0]])

    def _resolve_url_sync(self, url: str) -> Resolved:
        opts = _options(extract_flat="in_playlist", playlistend=PLAYLIST_LIMIT, format="bestaudio/best")
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except DownloadError as exc:
            raise _friendly_error(exc) from exc
        if not info:
            raise YouTubeError("Не вдалося прочитати посилання.")

        if info.get("_type") == "playlist" or "entries" in info:
            tracks = [t for e in info.get("entries") or [] if (t := _track_from_entry(e))]
            if not tracks:
                raise YouTubeError("У плейлисті нема доступних відео.")
            return Resolved(
                tracks=tracks,
                playlist_title=info.get("title") or "Плейлист",
                playlist_url=info.get("webpage_url") or url,
            )

        track = _track_from_entry({**info, "ie_key": "Youtube"})
        if track is None:
            raise YouTubeError("За посиланням нема відео.")
        track.thumbnail = _best_thumbnail(info)
        return Resolved(tracks=[track])

    # ---------- стрім ----------

    async def stream(self, track: Track) -> Stream:
        """Свіже пряме аудіо-посилання. Викликати безпосередньо перед відтворенням."""
        return await self._run(self._stream_sync, track.url)

    def _stream_sync(self, url: str) -> Stream:
        started = time.perf_counter()
        opts = _options(format="bestaudio[acodec=opus]/bestaudio/best")
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except DownloadError as exc:
            raise _friendly_error(exc) from exc
        if not info:
            raise YouTubeError("yt-dlp нічого не повернув.")

        stream_url = info.get("url")
        available_at = info.get("available_at") or 0
        if not stream_url:
            for fmt in info.get("requested_formats") or []:
                if fmt.get("acodec") not in (None, "none"):
                    stream_url = fmt.get("url")
                    available_at = fmt.get("available_at") or available_at
                    break
        if not stream_url:
            raise YouTubeError("Не знайшов аудіо-потік для цього відео.")

        live = bool(info.get("is_live"))
        duration = info.get("duration")
        stream = Stream(
            url=stream_url,
            duration=int(duration) if duration and not live else None,
            is_live=live,
            thumbnail=_best_thumbnail(info),
            fetched_at=time.monotonic(),
            available_at=float(available_at),
        )
        log.debug(
            "Стрім %s (%s) за %.2fс, доступний через %.1fс",
            info.get("id"),
            info.get("format_id"),
            time.perf_counter() - started,
            stream.wait_seconds(),
        )
        return stream

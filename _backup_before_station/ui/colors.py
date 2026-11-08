"""Домінантний «настрійний» колір мініатюри для смужки embed."""

from __future__ import annotations

import asyncio
import colorsys
import io
import logging
from collections import OrderedDict

import aiohttp
from PIL import Image

log = logging.getLogger(__name__)

_CACHE_MAX = 512


def _pick_color(data: bytes) -> int | None:
    with Image.open(io.BytesIO(data)) as img:
        small = img.convert("RGB").resize((64, 36))
    quantized = small.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette() or []
    counts = quantized.getcolors() or []
    total = sum(count for count, _ in counts) or 1

    best: tuple[float, tuple[float, float, float]] | None = None
    for count, index in counts:
        r, g, b = (c / 255 for c in palette[index * 3 : index * 3 + 3])
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        if v < 0.18 or (s < 0.12 and v > 0.85):
            continue  # чорні смуги, білий фон
        # Яскравий і насичений колір важить більше за просто «найчастіший».
        score = (count / total) * (0.35 + s) * (0.4 + v)
        if best is None or score > best[0]:
            best = (score, (h, s, v))
    if best is None:
        return None

    h, s, v = best[1]
    # Трохи підсилюємо, щоб смужка не була брудною на темній темі Discord.
    s = min(1.0, max(s, 0.45) * 1.1)
    v = min(1.0, max(v, 0.75))
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (int(r * 255) << 16) | (int(g * 255) << 8) | int(b * 255)


class ColorPicker:
    def __init__(self, fallback: int) -> None:
        self.fallback = fallback
        self._cache: OrderedDict[str, int] = OrderedDict()
        self._session: aiohttp.ClientSession | None = None

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def color_for(self, key: str, image_url: str) -> int:
        if (cached := self._cache.get(key)) is not None:
            self._cache.move_to_end(key)
            return cached
        color = self.fallback
        try:
            if self._session is None or self._session.closed:
                self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5))
            async with self._session.get(image_url) as resp:
                resp.raise_for_status()
                data = await resp.read()
            picked = await asyncio.to_thread(_pick_color, data)
            if picked is not None:
                color = picked
        except Exception as exc:  # колір — косметика, не валимо через нього плеєр
            log.debug("Не вдалося визначити колір %s: %r", image_url, exc)
            return color
        self._cache[key] = color
        while len(self._cache) > _CACHE_MAX:
            self._cache.popitem(last=False)
        return color

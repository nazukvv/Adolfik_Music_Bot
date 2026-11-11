# Прогрес: акаунти, лайки, плейлисти і редизайн Activity

Гілка: `feature/accounts-redesign` (від `main` = `94d495f`). **Не запушено.**
Стан на 2026-11-11.

ТЗ виконується етапами, після кожного зупинка зі звітом і згодою на наступний:

| # | Етап | Стан |
|---|------|------|
| 1 | Бекенд (БД + API), прибрати автозахід бота | ✅ готово, закомічено |
| 2 | Дизайн-каркас: сайдбар, нижній плеєр, права панель, роутинг | ⏳ не почато |
| 3 | Лайки і плейлисти в UI | ⏳ не почато |
| 4 | Шліфування, адаптив 360/768/1280, скріншоти `_preview\`, інструкція викатки | ⏳ не почато |

Жорсткі вимоги, що діють на всіх етапах:

- `davey>=0.1.7,<0.2` у `requirements.txt` не чіпати (з 0.2 бот без звуку).
- `/play`, музичний канал (`/setup`), Discord-панель, автовихід, передзавантаження, WS-стан — не ламати.
- `data/adolfik.db` не потрапляє в git (`data/` у `.gitignore`, перевірено `git check-ignore`).
- Бренд — Adolfik; логотип і назву референсу (Musiko.io) не копіювати.
- Комітити логічними кроками; пушити лише на прохання.

---

## Етап 1 — зроблено

### Коміти

| Коміт | Що |
|-------|----|
| `397605a` | Activity: бот більше не заходить у войс сам (прибрано `useAutoSummon`, `App.tsx` повернуто до версії `02e918d`) |
| `32a94d5` | SQLite-бібліотека і API лайків, плейлистів, історії |
| `fa28c65` | Панель: кнопка ❤ «В улюблені» |
| `f5e2d44` | Privacy Policy: бібліотека Activity, історія і видалення даних |

### Змінені й нові файли

| Файл | Зміни |
|------|-------|
| `webapi/library.py` (новий) | Шар зберігання: клас `Library` (aiosqlite), міграції, лайки, плейлисти, історія, видалення даних |
| `webapi/library_api.py` (новий) | Mixin `LibraryApi` для `ActivityServer`: маршрути `/api/me/...` і `/api/history` |
| `webapi/errors.py` (новий) | `ApiError(status, message, code=None)` — винесено з `server.py`, додано машинний `code` |
| `webapi/server.py` | `ActivityServer(LibraryApi)`; профіль при `/api/token`; `_check_can_play` / `_enqueue_for` (спільна логіка play); `library_event()` у WS; middleware віддає `code` і обробляє `LibraryError` |
| `bot.py` | `self.library`; `_open_library()` у `setup_hook` перед стартом веб-сервера; запис історії через `players.on_track_start`; закриття БД у `close()` |
| `player.py` | `PlayerManager.on_track_start()`, `track_started()`, `all()`; `_play_track` повідомляє підписників, коли трек реально заграв |
| `youtube.py` | `known(video_id)` — трек із кешу пошуку; `resolve(..., playlist_limit=)` для імпорту до 1000 треків |
| `config.py` | `DB_FILE = data/adolfik.db` |
| `ui/panels.py` | Кнопка `adolfik:like` (❤ «В улюблені») у ряду гучності; доступна без входу у войс; ephemeral-відповідь |
| `requirements.txt` | `aiosqlite>=0.20` (рядок davey без змін) |
| `legal/PRIVACY.md` | Розділи про бібліотеку Activity й історію; кнопка «Delete my data» + GitHub Issues |
| `activity/src/App.tsx` | Прибрано автозахід (лише повернення до старої версії) |

### Рішення: поведінка бота у войсі

- Activity **сама бота не кличе**. Будь-яке «грати» з Activity (`/api/play`, `/api/me/likes/play`,
  `/api/me/playlists/{id}/play`) проходить `_check_can_play`:
  - користувач не у войсі → `409 {code: "not_in_voice"}`;
  - бота нема в каналі користувача і нема `summon: true` → `409 {code: "summon_required"}`
    («Спершу поклич бота у свій войс» / «Бот зараз у «X» — поклич його до себе»);
  - `summon: true` → бот заходить і одразу грає (це майбутня кнопка «Покликати й грати»).
- `/api/summon` (явна кнопка «Покликати бота») не змінювався.
- `/play` і музичний канал працюють як раніше — правило їх не стосується.

### Рішення: схема БД (`data/adolfik.db`, версія схеми 1)

- aiosqlite, одне з'єднання, `isolation_level=None` + явний `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` під `asyncio.Lock` (`Library._tx()`).
- `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`.
- Міграції: список `MIGRATIONS = [(версія, [SQL, ...])]`, поточна версія в таблиці `schema_version`.
  Кожна міграція — окремі `execute` в одній транзакції (не `executescript`, бо він неявно комітить).
  Нова міграція = новий елемент `(2, [...])` у кінець списку.
- Якщо БД не відкрилась — бот працює далі без бібліотеки (`bot.library = None`, API бібліотеки → 503).

```
users(id PK = Discord user id, name, avatar, created_at, last_seen_at)
tracks(video_id PK, title, channel, duration, thumbnail, updated_at)        -- спільний кеш метаданих
likes(user_id FK→users ON DELETE CASCADE, video_id FK→tracks, created_at, PK(user_id, video_id))
playlists(id PK AUTOINCREMENT, user_id FK→users ON DELETE CASCADE, name, created_at, updated_at)
playlist_tracks(id PK AUTOINCREMENT = entry_id, playlist_id FK→playlists ON DELETE CASCADE,
                video_id FK→tracks, position, added_at)                       -- той самий трек може стояти двічі
play_history(id PK AUTOINCREMENT, guild_id, video_id FK→tracks, requester_id NULL, played_at)
індекси: likes_by_user, playlists_by_user, playlist_tracks_order,
         play_history_by_guild, play_history_by_requester
```

- Трек = `video_id + title + channel + duration + thumbnail`. Метадані **лише з серверних джерел**
  (`_server_track`: кеш пошуку `yt.known` → черги плеєрів → БД → `yt.resolve` з таймаутом 25 с),
  клієнт передає тільки `video_id` — підмінити назву чи обкладинку не можна.
- Записи `tracks`, на які вже ніщо не посилається, прибираються (`_prune_tracks`) після видалень.
- Історія: останні `HISTORY_PER_GUILD = 300` відтворень на сервер; пишеться, коли трек реально заграв.
- Профіль створюється/оновлюється (`touch_user`) при кожному вході в Activity (`/api/token`),
  а також при першому лайку кнопкою ❤ у Discord.
- Видалення даних (`delete_user`): профіль + лайки + плейлисти (каскад), в історії `requester_id = NULL`.
  При наступному вході створюється новий порожній профіль.

Ліміти (`webapi/library.py`, `webapi/library_api.py`):

| Що | Ліміт |
|----|-------|
| Плейлистів на користувача | 100 |
| Треків у плейлисті | 1000 |
| Лайків | 5000 |
| Довжина назви плейлиста | 100 |
| Треків за один запит додавання | 50 |
| Записів у бібліотеку | 60 / хв (рахуються й відхилені спроби) |
| Імпорт плейлиста | 5 / хв |
| `DELETE /api/me` | 3 / хв |
| Play (усі джерела) | 8 / 10 с |

### Рішення: API

Усі `/api/me/...` вимагають сесію (HMAC-токен з `/api/token`; у DEV_MODE — `X-Dev-User` лише з localhost).
Чужий плейлист → `404` (не `403`, щоб не світити існування). Помилки: `{"error": "текст", "code"?: "..."}`.

| Метод | Шлях | Тіло / відповідь |
|-------|------|------------------|
| GET | `/api/me` | `{id, name, avatar, dev, library, created_at, stats{likes, playlists, playlist_tracks, plays}, limits}` |
| DELETE | `/api/me` | Видалити свої дані → `{ok, deleted{profile, likes, playlists, history_anonymized}}` |
| GET | `/api/me/recent` | «Продовжити слухати» — мої нещодавні → `{tracks}` |
| GET | `/api/me/likes` | `{tracks, total}` (новіші першими) |
| GET | `/api/me/likes/ids` | `{ids}` — щоб малювати ❤ у будь-якому списку |
| PUT | `/api/me/likes/{video_id}` | Лайк → `{ok, liked: true, added}` |
| DELETE | `/api/me/likes/{video_id}` | Зняти лайк → `{ok, liked: false, removed}` |
| POST | `/api/me/likes/play` | `{guild, mode: queue\|next\|now, shuffle?, summon?}` |
| GET | `/api/me/playlists` | `{playlists: [{id, name, track_count, duration, cover[≤4], created_at, updated_at}], limit}` |
| POST | `/api/me/playlists` | `{name, video_id?\|video_ids?}` → `{ok, playlist}` |
| POST | `/api/me/playlists/import` | `{url, name?}` (YouTube-плейлист) → `{ok, playlist, imported}` |
| GET | `/api/me/playlists/{id}` | `{id, name, ..., cover, tracks: [{...track, entry_id, added_at}]}` |
| PATCH | `/api/me/playlists/{id}` | `{name}` — перейменувати |
| DELETE | `/api/me/playlists/{id}` | Видалити плейлист |
| POST | `/api/me/playlists/{id}/tracks` | `{video_id\|video_ids}` → `{ok, added, skipped}` |
| DELETE | `/api/me/playlists/{id}/tracks/{entry_id}` | Прибрати запис |
| POST | `/api/me/playlists/{id}/reorder` | `{entry_id, to}` — запис стає на позицію `to` (з 0) |
| POST | `/api/me/playlists/{id}/play` | `{guild, mode, shuffle?, summon?}` |
| GET | `/api/history?guild=` | Нещодавно на сервері → `{tracks: [{...track, requester, played_at}]}` |
| POST | `/api/play` | + `summon?` (див. правило вище) |

Формат треку однаковий для черги, пошуку і бібліотеки:
`{id, key, title, channel, duration, is_live, url, thumbnail, thumbnail_small, requester}`.
Ключі: `entry-<id>` у плейлисті, `recent-<video_id>` в історії.

**WS-події бібліотеки** (`/api/ws`, лише з'єднанням власника, зокрема після ❤ у Discord):
`{"type": "library", "what": "likes", video_id, liked}`,
`{"type": "library", "what": "playlists", playlist_id, deleted?}`,
`{"type": "library", "what": "deleted"}`.

### Перевірка етапу 1

- Тест API бібліотеки з підставним Discord і справжньою `Library` на тимчасовій БД (реальні запити в YouTube): **47/47**.
- Тест шару БД: **37/37**.
- Регресія: API Activity **57/57**, етап 3 Activity **23/23**, злиття оновлень панелі **10/10**.
- `ruff check`, `ruff format --check`, `py_compile`, `npm run build` — ок.
- `python bot.py --check` — ок (вхід у Discord, БД створено зі схемою v1, 16 команд).

Тести лежать поза репозиторієм (scratchpad сесії Claude), у git їх нема.

### Ручна перевірка в Discord (ще не зроблено)

1. Відкрити Activity, коли бота нема у войсі → бот не заходить сам; пошук працює.
2. «Грати» в старому UI → підказка «Спершу поклич бота»; кнопка «Покликати бота» в шапці працює.
3. ❤ на панелі під час треку → ephemeral «додано в улюблені», повторно — знімає.
4. `/play` і музичний канал — як раніше.

---

## Етапи 2–4 — що залишилось

Візуальний референс: `design/reference-artist.png` (папка `design/` не закомічена — файл користувача).

### Ключові параметри дизайну

- 3 колонки на чорному фоні; сайдбар ~240px `#121212`; центр `#0a0a0a`–`#0d0d0d`; права панель ~290px.
- Акцент один — зелений `#00BD12` (Play, активний пункт, трек, що грає, еквалайзер); червоний `#D61A0C` лише для ❤.
- Вторинний текст `#9a9a9a`; кнопка-пігулка другорядна `#393939`; роздільники таблиці `#1f1f1f`; доріжка прогресу `#515151`, заповнення біле, без кружечка.
- Пігулки повністю круглі, картки ~12px. Шрифт Poppins (або схожий) — **локально в `activity/`**.
- Сайдбар: Головна, Пошук, Улюблені, Мої плейлисти + список (🗑 при наведенні), «+ Новий плейлист», внизу «Налаштування»; активний пункт `#1a1a1a` + зелена смужка праворуч. Без Go Premium/Podcast/Artists.
- Hero: декоративні кола/дуги, маленький підпис («Плейлист» / «Улюблені» / «Зараз грає на сервері»), заголовок ~40px жирний, сірий підпис, Play (зелена) + Shuffle/Змінити (сіра); вкладки текстом.
- Таблиця: рядки ~65px, «# N», обкладинка 32px, назва біла жирна, канал сірим, тривалість, ❤ (контур, якщо не лайкнуто), «⋯» (У плейлист, У чергу, Прибрати); трек, що грає, — зелена назва й анімований еквалайзер замість номера.
- Права панель: картка «Далі в черзі», під нею «Зараз грає» (велика обкладинка з градієнтом, назва/канал/хто замовив, кнопка-контур «В плейлист»).
- Плеєр внизу **центральної** колонки: ❤, гучність, ⏮, велика біла кругла ⏯, ⏭, повтор, shuffle; під ним тонкий прогрес із часом.
- Мобільна (<768): права панель схована, сайдбар → нижня навігація, компактний плеєр над навігацією.

### Структура фронтенду

Зараз (`activity/src`): `App.tsx` (завантаження, вибір сервера, макет), `components/` — `NowPlaying`,
`MiniPlayer`, `CompactPlayer`, `QueueList`, `SearchBox`, `SearchPanel`, `Cover`, `EmptyState`, `Logo`,
`Shell` (Splash/Fatal/GuildPicker), `Toasts`; `lib/` — `api` (fetch + сесія), `store` (живий стан з WS),
`actions`, `discord` (Embedded App SDK), `env`, `format`, `hooks`, `media`, `perms`, `toasts`, `types`.

**План** (ще не реалізовано, може уточнитись на етапі 2):

```
activity/src/
  layout/   AppLayout (сітка 3 колонки / мобільна), Sidebar, BottomNav, PlayerBar, RightPanel (Черга / Зараз грає)
  pages/    HomePage (продовжити слухати, мої плейлисти, нещодавно на сервері), SearchPage,
            LikesPage, PlaylistPage, ProfilePage (аватар, статистика, «Видалити мої дані»)
  components/ Hero, TrackTable/TrackRow, TrackMenu (⋯), LikeButton, AddToPlaylistMenu,
            PlaylistCover (колаж із 4), Equalizer, SummonButton («Покликати бота» / «Покликати й грати»)
  lib/      router (простий, без зовнішньої залежності — Activity працює в iframe Discord),
            library (store: likes ids, плейлисти; оновлення з WS-подій library)
  public/fonts/  Poppins *.woff2
```

Повторно використати: `api`, `store`, `actions`, `discord`, `media` (проксі `/ytimg`, `/dcdn`), `Cover`, `Toasts`.

### Етап 2 — дизайн-каркас

- Сайдбар, центральна колонка з навігацією ← →, нижній плеєр, висувна права панель, роутинг сторінок.
- Локальні шрифти, кольори як токени (Tailwind theme).
- «Покликати бота» — помітна; на порожньому стані — головна дія.

### Етап 3 — лайки і плейлисти в UI

- ❤ на будь-якому треку (пошук, черга, історія, плейлист, плеєр, права панель), стан із `/api/me/likes/ids` + WS.
- «Улюблені»: грати всі / в чергу / перемішати.
- Плейлисти: створити, перейменувати, видалити, колаж, «+ У плейлист», прибрати, перетягування (`reorder`), грати / в чергу, імпорт за посиланням.
- Кнопки «грати», коли бота нема: одна кнопка «Покликати й грати» (`summon: true`) або підказка за `code: summon_required`.
- Профіль: статистика, «Видалити мої дані» з підтвердженням (`DELETE /api/me`).

### Етап 4 — шліфування

- Адаптив 360 / 768 / 1280; скріншоти в `_preview\` на 3 ширинах, порівняння з `design\`.
- Вирішити: `_preview/` у `.gitignore` чи комітити (зараз не ігнорується).
- Опис ручної перевірки в Discord; повторити всі тести й `bot.py --check`.
- Інструкція викатки:
  1. `git push` (гілка → злиття в `main`);
  2. на VPS: `git pull`, `bash deploy/install.sh` (поставить `aiosqlite`), `sudo systemctl restart adolfik`.

---

## Відомі проблеми й нюанси

- **Проміжний стан UI.** Старий фронтенд не знає про `summon: true`: «грати», коли бота нема у войсі,
  дає тост «Спершу поклич бота» (409). Кнопка «Покликати бота» є. Повноцінне «Покликати й грати» — етапи 2–3.
- Ліміт записів рахує й відхилені спроби (наприклад, запис у чужий плейлист) — так задумано.
- Неверифікований застосунок Discord: Activity запускається лише на серверах < 25 учасників
  (або власником застосунку).
- Фонові процеси бота, запущені з сесії Claude, гинуть разом із нею — для постійної роботи `start.bat` або systemd.
- Різні закінчення рядків у файлах: CRLF — `bot.py`, `player.py`, `README.md`, `start.bat`, `stations.py`,
  `ui/embeds.py`, `ui/views.py`, `cogs/station.py`, `tunnel.bat`; решта LF. Правки мають їх зберігати.
- YouTube: `available_at` ~5 с після отримання посилання (інакше 403) — плеєр чекає й передзавантажує.
- `design/` не в git; `_preview/` ще не існує.

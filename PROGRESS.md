# Прогрес: акаунти, лайки, плейлисти і редизайн Activity

Гілка: `feature/accounts-redesign` (від `main` = `94d495f`). **Не запушено.**
Стан на 2026-11-11.

ТЗ виконується етапами, після кожного зупинка зі звітом і згодою на наступний:

| # | Етап | Стан |
|---|------|------|
| 1 | Бекенд (БД + API), прибрати автозахід бота | ✅ готово, закомічено |
| 2 | Дизайн-каркас: сайдбар, нижній плеєр, права панель, роутинг | ✅ готово, закомічено |
| 3 | Лайки і плейлисти в UI | ✅ готово, закомічено |
| 4 | Шліфування, адаптив 360/768/1280, скріншоти `_preview\`, інструкція викатки | ✅ готово, закомічено |

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
2. (після етапу 2) «Грати», коли бота нема, підписано «Покликати й грати» — одна кнопка кличе й вмикає.
3. ❤ на панелі під час треку → ephemeral «додано в улюблені», повторно — знімає.
4. `/play` і музичний канал — як раніше.

---

## Етап 2 — зроблено

### Коміти

| Коміт | Що |
|-------|----|
| `4584f3f` | Локальний шрифт Montserrat і палітра за референсом |
| `0f1a754` | Новий каркас: сайдбар, плеєр унизу, права панель, сторінки |

### Рішення

- **Шрифт — Montserrat, не Poppins.** Poppins не має кирилиці, а інтерфейс український. Montserrat — схожий
  геометричний шрифт із кирилицею (SIL OFL). Лежить файлами в `activity/src/fonts/` (4 woff2 + `OFL.txt`),
  Vite кладе їх у `dist/assets`; зовнішніх запитів нема (Discord їх блокує). Нових npm-залежностей нема.
- **Кольори — токени Tailwind** у `src/index.css` (`@theme`): `ink #000`, `side #121212`, `main #0b0b0b`
  (не `center`: `bg-center` — це background-position), `hover #1a1a1a`, `raise`, `line #1f1f1f`, `pill #393939`,
  `track #515151`, `dim #9a9a9a`, `faint`, `green #00BD12`, `heart #D61A0C`. Динамічний акцент за обкладинкою прибрано
  (у дизайні акцент один — зелений).
- **Роутер у пам'яті** (`lib/router.ts`) з історією для ← →; адресу iframe не чіпаємо. Для браузера/скріншотів —
  стартова сторінка `?page=search|likes|library|profile|playlist-<id>`.
- **Брейкпоінти:** <768 — нижня навігація + компактний плеєр, «Зараз грає» на весь екран; 768–1279 — сайдбар,
  права панель виїжджає поверх; ≥1280 — три колонки, права панель ховається кнопкою. Шапка сторінки й колонки таблиці
  підлаштовуються під ширину **центральної колонки** (container queries `@3xl`/`@4xl`), а не вікна.
- **Липка верхня панель** прозора над шапкою (кола шапки заходять під ← →), темніє при прокрутці.
- **Бот не у войсі користувача** (`perms.needsSummon`) → усі кнопки «грати» підписані «Покликати й грати» й шлють
  `summon: true`; якщо стан змінився між рендером і кліком — тост із підказкою за `code: summon_required`.
  «Покликати бота» — зелена пігулка у верхній панелі й головна дія на порожній Головній.
- **❤ підключено вже на етапі 2** (лайк — один PUT/DELETE): оптимістично, з відкатом при помилці; стан із
  `/api/me/likes/ids` і WS-подій `library`. Меню «⋯» поки має «Грати зараз / Наступним / У чергу».
- PIP-режим Discord (висота ≤420px) — як і раніше, `CompactPlayer`.

### Структура фронтенду (`activity/src`)

```
App.tsx                 завантаження (Discord SDK / DEV), вибір сервера, старт live + library
lib/
  api.ts                fetch + сесія; ApiError.code; методи /api/me/...
  store.ts              живий стан з WS; onLibrary() — події бібліотеки
  library.ts            стор бібліотеки: me, liked (Set), playlists, version; toggleLike()
  router.ts             роутер у пам'яті, ← →, ?page=
  actions.ts            play/summon-логіка, playLikes/playPlaylist, керування чергою
  perms.ts              canControl / canAdd / needsSummon / canSummon, playLabel()
  hooks.ts              useMediaQuery, useDebounced, useLoad (дані сторінки)
  format.ts             fmtTime, fmtTotal, timeAgo, fmtDate, plural
components/
  layout/AppShell.tsx   сітка колонок, брейкпоінти, гарячі клавіші (пробіл, /)
  layout/Sidebar.tsx    сайдбар + BottomNav (телефон)
  layout/TopBar.tsx     ← →, стан бота, «Покликати бота», аватар → профіль
  layout/Player.tsx     PlayerBar, Controls, PlayPause, SeekBar, VolumeButton, MobilePlayer
  layout/RightPanel.tsx RightPanel / RightDrawer / NowPlayingSheet, «Далі в черзі», «Зараз грає»
  layout/QueueList.tsx  черга з перетягуванням
  pages/HomePage.tsx    що грає, мої плейлисти, нещодавно на сервері / продовжити слухати
  pages/SearchPage.tsx  пошук (живі результати таблицею), посилання YouTube
  pages/LibraryPages.tsx LikesPage, LibraryPage, PlaylistPage, ProfilePage
  pages/Cards.tsx       PlaylistCard, PlaylistGrid
  ui/Hero.tsx           Hero (кола), Tabs, SectionTitle
  ui/TrackTable.tsx     таблиця треків, TableEmpty
  ui/Menu.tsx           «⋯» (портал у body, відкривається вгору, якщо внизу тісно)
  ui/Buttons.tsx        Pill (green/gray/outline), IconButton, RoundNav
  ui/Bits.tsx           Equalizer, LikeButton, PlaylistCover (колаж), LikesCover, Avatar
  Cover, CompactPlayer, EmptyState, Logo, Shell, Toasts
```

### Перевірка етапу 2

- `npm run build` (tsc strict + vite) — ок.
- Демо-бекенд (справжні ActivityServer/плеєр/YouTube + `Library` на тимчасовій БД, підставний Discord) у браузері:
  Головна/Улюблені/плейлист/пошук/профіль; «Покликати й грати» одним кліком — бот зайшов і заграв;
  ❤ знімає лайк — список і лічильник оновились через WS; меню «⋯»; ← →.
- Скріншоти: `_preview/stage2/{1280,768,360}-{home,likes,playlist-1,search,library,profile}.png`
  (Chrome через DevTools-протокол з емуляцією ширини; `_preview/` у `.gitignore`).
- Бекенд на етапі 2 не змінювався.

---

## Етап 3 — зроблено

### Коміти

| Коміт | Що |
|-------|----|
| `4dda61f` | Діалоги плейлистів і видалення даних (API-клієнт, стор, `lib/dialogs.ts`, `components/Dialogs.tsx`) |
| `3c50b16` | Лайки й плейлисти в інтерфейсі (меню, сторінки, сайдбар, права панель, черга, профіль) |

### Що з'явилось

- **«⋯» на будь-якому треку:** Грати зараз / Наступним / У чергу / **У плейлист**; на сторінці плейлиста —
  «Прибрати з плейлиста», в улюблених — «Прибрати з улюблених».
- **Діалог «Додати в плейлист»:** список плейлистів (пошук, якщо їх >6), «Новий плейлист» прямо в діалозі
  (створити й одразу додати), повний плейлист (1000) неактивний.
- **Сторінка плейлиста:** Грати / Перемішати / Змінити (перейменувати) / «⋯» (додати все в чергу, видалити);
  перетягування рядків за ручку (миша, тач із затримкою, клавіатура) — новий порядок одразу, сервер підтверджує.
- **Сайдбар:** «+» біля «Плейлисти», рядок «Новий плейлист», 🗑 при наведенні (з підтвердженням).
- **Мої плейлисти:** «Новий плейлист», «Імпорт з YouTube» (посилання + необов'язкова назва; після імпорту —
  перехід на новий плейлист).
- **Права панель:** кнопка-контур «В плейлист» під «Зараз грає»; ❤ у рядках черги.
- **Профіль:** розділ «Мої дані» → діалог зі списком, що буде видалено (з цифрами), і галочкою
  «Розумію, що це не можна скасувати» → `DELETE /api/me` → тост і перехід на Головну.

### Рішення

- Один діалог на весь застосунок (`openDialog({kind, ...})`), малює його `AppShell` через портал — будь-яка кнопка
  відкриває потрібний без прокидання стану.
- Методи стору для діалогів кидають помилку — діалог показує її під полем (ліміти, порожня назва, не плейлист);
  решта дій (прибрати, порядок) — тостом. Після запису стор одразу перечитує список плейлистів; WS-подія `library`
  оновлює й інші вкладки.
- Масове «додати весь плейлист в інший» не робив: API приймає до 50 треків за запит.

### Перевірка етапу 3

- `npm run build` — ок. Бекенд не змінювався.
- На демо-бекенді в браузері пройдено: створити (з сайдбару) → перехід на порожній плейлист; «⋯ → У плейлист» з
  Улюблених; перетягування (порядок збережено на сервері, перевірено `GET /api/me/playlists/1`); перейменування;
  «Прибрати з плейлиста»; видалення через 🗑; імпорт YouTube-плейлиста (182 треки); «Покликати й грати» + «В плейлист»
  з правої панелі; «Видалити мої дані» (тост «7 лайків, 4 плейлисти», сайдбар і Улюблені порожні).
- Скріншоти: `_preview/stage3/{1280,768,360}-{home,playlist-1,library,profile}.png`.

---

## Етап 4 — зроблено

### Коміти

| Коміт | Що |
|-------|----|
| `ad8b10b` | Адаптив: менші пігулки на телефоні; компактна шапка/обкладинки у невисокому вікні (варіанти `short`/`tall`) |
| (цей) | README (керування, API), PROGRESS.md: ручна перевірка й викатка |

### Перевірка (вся гілка)

- `ruff check`, `ruff format --check`, `py_compile` — ок.
- Тести (scratchpad сесії, поза репозиторієм): БД 37/37, API бібліотеки 47/47, API Activity 57/57,
  етап 3 Activity 23/23, злиття оновлень панелі 10/10, Components V2 панелі — ок.
- `npm run build` — ок; `python bot.py --check` — ок (БД схема v1, 16 команд).
- Скріншоти `_preview/stage4/{1280x800,1280x650,768x1024,360x740}-{home,likes,playlist-1,search,library,profile}.png`.
  Порівняння з `design/reference-artist.png`: три колонки на чорному, сайдбар з активним пунктом і зеленою смужкою,
  шапка з колами, зелена Play + сірі пігулки, таблиця (# / еквалайзер, ❤ червоне, «⋯»), трек, що грає, — зелений,
  права панель «Далі в черзі» + «Зараз грає» з кнопкою-контуром «В плейлист», плеєр унизу центральної колонки з великою
  білою ⏯ і тонким прогресом без кружечка. Свідомі відмінності: шрифт Montserrat (Poppins без кирилиці); шапка ставить
  кнопки під заголовком, коли центральна колонка вужча за ~900px; бренд і логотип — Adolfik.

### Ручна перевірка в Discord

Перед перевіркою на ПК: зупинити бота на VPS (`sudo systemctl stop adolfik adolfik-tunnel`), `start.bat`,
`tunnel.bat`, адресу тунелю — в Developer Portal → Activities → URL Mappings `/`.

1. **Автозахід прибрано:** зайти у войс без бота, відкрити Activity → бот не заходить; Головна пропонує
   «Покликати бота»; на треках — «Покликати й грати» (одне натискання: бот заходить і грає).
2. **Пошук:** набрати запит → таблиця результатів; вставити посилання YouTube → «Увімкнути» / «У чергу».
3. **❤:** лайкнути трек у таблиці → з'являється в «Улюблених» і лічильнику сайдбару; ❤ на панелі бота в Discord →
   Activity оновлюється без перезавантаження; повторне ❤ знімає.
4. **Плейлисти:** «+» у сайдбарі → створити; «⋯ → У плейлист» з пошуку; на сторінці плейлиста — перетягнути трек,
   «Змінити» назву, «⋯ → Прибрати з плейлиста», «Грати» / «Перемішати» / «⋯ → Додати все в чергу»;
   «Мої плейлисти → Імпорт з YouTube» зі своїм плейлистом; 🗑 у сайдбарі з підтвердженням.
5. **Приватність:** другий акаунт відкриває Activity → не бачить чужих плейлистів і лайків.
6. **Права панель:** «Далі в черзі», «Зараз грає», «В плейлист», вкладка «Черга» (перетягування, ✕, клік — перейти).
7. **Профіль:** статистика; «Видалити мої дані» (галочка → видалено, Головна, бібліотека порожня).
8. **Без регресій:** `/play`, `/queue`, музичний канал (`/setup`), кнопки панелі, автовихід із порожнього войсу.
9. **Вікно:** звичайне вікно Activity (низьке, ~650px) — шапка, таблиця й плеєр видно; маленьке вікно (PIP) —
   компактний плеєр; Discord на телефоні — нижня навігація, компактний плеєр, «Зараз грає» на весь екран.

### Викатка на VPS

1. На ПК: `git push -u origin feature/accounts-redesign`, потім злити в `main` (PR або
   `git checkout main && git merge feature/accounts-redesign && git push`).
2. На VPS (у теці бота):
   ```bash
   git pull
   bash deploy/install.sh        # поставить aiosqlite і збере фронтенд (npm ci && npm run build)
   sudo systemctl restart adolfik
   ```
3. Якщо тунель перезапускався — нова адреса: `journalctl -u adolfik-tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1`
   → Developer Portal → URL Mappings `/`.
4. Перевірити лог: `journalctl -u adolfik -n 50` — рядок `БД: …/data/adolfik.db (схема v1)`.
   `data/adolfik.db` створюється сама і в git не потрапляє.

---

## Відомі проблеми й нюанси

- Скріншоти з демо-бекенду: картинки в рядках вантажаться ліниво (`loading="lazy"`), на знімку частина може бути
  ще порожньою — це не вада верстки.
- Headless Chrome з `--window-size` не вміє вужче ~500px — для 360 знімати лише з емуляцією пристрою (CDP).
- Ліміт записів рахує й відхилені спроби (наприклад, запис у чужий плейлист) — так задумано.
- Неверифікований застосунок Discord: Activity запускається лише на серверах < 25 учасників
  (або власником застосунку).
- Фонові процеси бота, запущені з сесії Claude, гинуть разом із нею — для постійної роботи `start.bat` або systemd.
- Різні закінчення рядків у файлах: CRLF — `bot.py`, `player.py`, `README.md`, `start.bat`, `stations.py`,
  `ui/embeds.py`, `ui/views.py`, `cogs/station.py`, `tunnel.bat`; решта LF. Правки мають їх зберігати.
- YouTube: `available_at` ~5 с після отримання посилання (інакше 403) — плеєр чекає й передзавантажує.
- `design/` не в git; `_preview/` у `.gitignore`.
- Тести й демо-бекенд лежать у scratchpad сесії Claude — у репозиторії їх нема (за потреби перенести в `tests/`).

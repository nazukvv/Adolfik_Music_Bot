import { CalendarDays, Headphones, Heart, Library, ListMusic, ListPlus, Play, Shuffle } from "lucide-react";
import type { ReactNode } from "react";
import { playLikes, playPlaylist } from "../../lib/actions";
import { api, type PlayOptions } from "../../lib/api";
import { fmtDate, fmtTotal, plural } from "../../lib/format";
import { useLoad } from "../../lib/hooks";
import { useLibrary } from "../../lib/library";
import { type Perms, playLabel } from "../../lib/perms";
import { router } from "../../lib/router";
import type { GuildState } from "../../lib/types";
import { Pill } from "../ui/Buttons";
import { Avatar, LikesCover, PlaylistCover } from "../ui/Bits";
import { Hero } from "../ui/Hero";
import { TableEmpty, TrackTable } from "../ui/TrackTable";
import { PlaylistGrid } from "./Cards";

type PlayFn = (options: Omit<PlayOptions, "summon">) => void;

/** Play / Перемішати / У чергу для цілого списку. */
function ListActions({ perms, count, play }: { perms: Perms; count: number; play: PlayFn }) {
  const disabled = !perms.canAdd || count === 0;
  const title = perms.canAdd ? undefined : (perms.hint ?? undefined);
  return (
    <>
      <Pill variant="green" disabled={disabled} title={title} onClick={() => play({ mode: "now" })}>
        {perms.needsSummon ? <Headphones className="size-[18px]" /> : <Play className="size-[18px] fill-current" />}
        {playLabel(perms)}
      </Pill>
      <Pill variant="gray" disabled={disabled} title={title} onClick={() => play({ mode: "now", shuffle: true })}>
        <Shuffle className="size-[18px]" /> Перемішати
      </Pill>
      <Pill variant="gray" disabled={disabled} title={title ?? "Додати все в кінець черги"} onClick={() => play({ mode: "queue" })}>
        <ListPlus className="size-[18px]" /> У чергу
      </Pill>
    </>
  );
}

function Unavailable() {
  return (
    <div className="pt-8">
      <TableEmpty icon={<Library />} title="Бібліотека недоступна" text="На сервері бота не вдалося відкрити базу даних — лайки й плейлисти тимчасово не працюють." />
    </div>
  );
}

function LibraryHeroArt({ children }: { children: ReactNode }) {
  return <div className="size-32 overflow-hidden rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] lg:size-40">{children}</div>;
}

/** Улюблені: шапка з «обкладинкою»-серцем, грати всі / перемішати / в чергу, таблиця. */
export function LikesPage({ state, perms }: { state: GuildState; perms: Perms }) {
  const lib = useLibrary();
  const likes = useLoad((signal) => (lib.ready ? api.likes(signal) : Promise.resolve(null)), [lib.version, lib.ready]);
  const tracks = likes.data?.tracks ?? [];
  const total = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);

  return (
    <>
      <Hero
        label="Улюблені"
        labelIcon={<Heart />}
        art={
          <LibraryHeroArt>
            <LikesCover className="size-full" rounded="" />
          </LibraryHeroArt>
        }
        title="Улюблені треки"
        subtitle={
          likes.data
            ? `${plural(likes.data.total, "трек", "треки", "треків")}${total ? ` · ${fmtTotal(total)}` : ""}`
            : lib.ready
              ? " "
              : undefined
        }
        actions={lib.ready && <ListActions perms={perms} count={tracks.length} play={(o) => void playLikes(o)} />}
      />
      {!lib.me ? null : !lib.ready ? (
        <Unavailable />
      ) : (
        <div className="border-t border-line pb-8">
          <TrackTable
            tracks={tracks}
            state={state}
            perms={perms}
            loading={likes.loading}
            empty={
              <div className="pt-8">
                <TableEmpty
                  icon={<Heart />}
                  title="Тут поки порожньо"
                  text="Натискай ❤ біля будь-якого треку — тут, у пошуку, у черзі або на панелі бота в Discord."
                />
              </div>
            }
          />
        </div>
      )}
    </>
  );
}

/** Мої плейлисти: Улюблені + усі плейлисти картками. */
export function LibraryPage({ perms }: { perms: Perms }) {
  const lib = useLibrary();
  return (
    <>
      <Hero
        label="Бібліотека"
        labelIcon={<Library />}
        title="Мої плейлисти"
        subtitle={lib.ready ? `${plural(lib.playlists.length, "плейлист", "плейлисти", "плейлистів")} · приватні, бачиш лише ти` : undefined}
      />
      {!lib.me ? null : !lib.ready ? (
        <Unavailable />
      ) : (
        <div className="pb-8">
          <PlaylistGrid
            perms={perms}
            onPlayLikes={() => void playLikes({ mode: "now" })}
            onPlayPlaylist={(id, name) => void playPlaylist(id, name, { mode: "now" })}
          />
        </div>
      )}
    </>
  );
}

/** Плейлист: шапка з колажем, Play/Перемішати/У чергу, таблиця треків. */
export function PlaylistPage({ id, state, perms }: { id: number; state: GuildState; perms: Perms }) {
  const lib = useLibrary();
  const summary = lib.playlists.find((p) => p.id === id);
  const playlist = useLoad((signal) => api.playlist(id, signal), [id, lib.version]);
  const data = playlist.data;
  const missing = playlist.error && !data;

  if (missing && !summary) {
    return (
      <>
        <Hero label="Плейлист" labelIcon={<ListMusic />} title="Плейлист не знайдено" subtitle="Можливо, його видалили." />
        <div className="px-4 sm:px-8">
          <Pill variant="gray" onClick={() => router.go({ name: "library" })}>
            <Library className="size-[18px]" /> До моїх плейлистів
          </Pill>
        </div>
      </>
    );
  }

  const name = data?.name ?? summary?.name ?? "";
  const count = data?.track_count ?? summary?.track_count ?? 0;
  const duration = data?.duration ?? summary?.duration ?? 0;
  return (
    <>
      <Hero
        label="Плейлист"
        labelIcon={<ListMusic />}
        art={
          <LibraryHeroArt>
            <PlaylistCover cover={data?.cover ?? summary?.cover ?? []} className="size-full" rounded="" />
          </LibraryHeroArt>
        }
        title={name || " "}
        subtitle={`${plural(count, "трек", "треки", "треків")}${duration ? ` · ${fmtTotal(duration)}` : ""}`}
        actions={<ListActions perms={perms} count={count} play={(o) => void playPlaylist(id, name, o)} />}
      />
      <div className="border-t border-line pb-8">
        <TrackTable
          tracks={data?.tracks ?? []}
          state={state}
          perms={perms}
          loading={playlist.loading}
          empty={
            <div className="pt-8">
              <TableEmpty icon={<ListMusic />} title="У плейлисті ще нема треків" text="Додавай треки з пошуку, черги чи улюблених." />
            </div>
          }
        />
      </div>
    </>
  );
}

/** Профіль: аватар, статистика. (Видалення даних — етап 3.) */
export function ProfilePage({ state }: { state: GuildState }) {
  const lib = useLibrary();
  const me = lib.me;
  const name = me?.name ?? state.you.name;
  const stats = me?.stats;
  return (
    <>
      <Hero
        label="Профіль"
        labelIcon={<CalendarDays />}
        art={<Avatar src={me?.avatar ?? state.you.avatar} name={name} className="size-32 text-4xl lg:size-40" />}
        title={name}
        subtitle={me?.created_at ? `В Adolfik з ${fmtDate(me.created_at)}` : "Акаунт Discord"}
      />
      {lib.me && !lib.ready ? (
        <Unavailable />
      ) : (
        <div className="grid grid-cols-2 gap-3 px-4 pb-8 sm:px-8 lg:grid-cols-4">
          <Stat label="В улюблених" value={stats?.likes} onClick={() => router.go({ name: "likes" })} />
          <Stat label="Плейлистів" value={stats?.playlists} onClick={() => router.go({ name: "library" })} />
          <Stat label="Треків у плейлистах" value={stats?.playlist_tracks} />
          <Stat label="Увімкнено треків" value={stats?.plays} />
        </div>
      )}
      <p className="px-4 pb-8 text-xs leading-relaxed text-faint sm:px-8">
        Профіль створюється автоматично з твого акаунта Discord (ім'я та аватар). Лайки й плейлисти приватні — їх бачиш лише ти.
      </p>
    </>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number | undefined; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-[28px] leading-none font-bold tabular-nums">{value ?? "—"}</p>
      <p className="mt-2 text-xs text-dim">{label}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-xl bg-side p-5 text-left transition hover:bg-hover">
      {body}
    </button>
  ) : (
    <div className="rounded-xl bg-side p-5">{body}</div>
  );
}


import {
  CalendarDays,
  Download,
  Headphones,
  Heart,
  HeartOff,
  Library,
  ListEnd,
  ListMusic,
  ListX,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  Shuffle,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { playLikes, playPlaylist } from "../../lib/actions";
import { api, type PlayOptions } from "../../lib/api";
import { openDialog } from "../../lib/dialogs";
import { fmtDate, fmtTotal, plural } from "../../lib/format";
import { useLoad } from "../../lib/hooks";
import { library, useLibrary } from "../../lib/library";
import { type Perms, playLabel } from "../../lib/perms";
import { router } from "../../lib/router";
import type { GuildState, PlaylistEntry } from "../../lib/types";
import { Pill } from "../ui/Buttons";
import { Avatar, LikesCover, PlaylistCover } from "../ui/Bits";
import { Hero } from "../ui/Hero";
import { MenuButton } from "../ui/Menu";
import { TableEmpty, TrackTable } from "../ui/TrackTable";
import { PlaylistGrid } from "./Cards";

type PlayFn = (options: Omit<PlayOptions, "summon">) => void;

/** Play / Перемішати для цілого списку (+ що додасть сторінка). */
function ListActions({ perms, count, play, children }: { perms: Perms; count: number; play: PlayFn; children?: ReactNode }) {
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
      {children}
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
  return <div className="size-28 overflow-hidden rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] tall:size-32 lg:tall:size-40">{children}</div>;
}

/** Улюблені: шапка з «обкладинкою»-серцем, грати всі / перемішати / в чергу, таблиця. */
export function LikesPage({ state, perms }: { state: GuildState; perms: Perms }) {
  const lib = useLibrary();
  const likes = useLoad((signal) => (lib.ready ? api.likes(signal) : Promise.resolve(null)), [lib.version, lib.ready]);
  const tracks = likes.data?.tracks ?? [];
  const total = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  const canQueue = perms.canAdd && tracks.length > 0;

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
        subtitle={likes.data ? `${plural(likes.data.total, "трек", "треки", "треків")}${total ? ` · ${fmtTotal(total)}` : ""}` : undefined}
        actions={
          lib.ready && (
            <ListActions perms={perms} count={tracks.length} play={(o) => void playLikes(o)}>
              <Pill
                variant="gray"
                disabled={!canQueue}
                title={perms.canAdd ? "Додати все в кінець черги" : (perms.hint ?? undefined)}
                onClick={() => void playLikes({ mode: "queue" })}
              >
                <ListEnd className="size-[18px]" /> У чергу
              </Pill>
            </ListActions>
          )
        }
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
            extraMenu={(track) => [{ label: "Прибрати з улюблених", icon: <HeartOff />, onSelect: () => void library.toggleLike(track) }]}
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

/** Мої плейлисти: Улюблені + усі плейлисти картками; створити новий або імпортувати з YouTube. */
export function LibraryPage({ perms }: { perms: Perms }) {
  const lib = useLibrary();
  const limit = lib.me?.limits.playlists ?? 100;
  return (
    <>
      <Hero
        label="Бібліотека"
        labelIcon={<Library />}
        title="Мої плейлисти"
        subtitle={lib.ready ? `${plural(lib.playlists.length, "плейлист", "плейлисти", "плейлистів")} · приватні, бачиш лише ти` : undefined}
        actions={
          lib.ready && (
            <>
              <Pill
                variant="green"
                disabled={lib.playlists.length >= limit}
                title={lib.playlists.length >= limit ? `Ліміт — ${limit} плейлистів` : undefined}
                onClick={() => openDialog({ kind: "create-playlist", open: true })}
              >
                <Plus className="size-[18px]" /> Новий плейлист
              </Pill>
              <Pill variant="gray" disabled={lib.playlists.length >= limit} onClick={() => openDialog({ kind: "import-playlist" })}>
                <Download className="size-[18px]" /> Імпорт з YouTube
              </Pill>
            </>
          )
        }
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

/** Плейлист: шапка з колажем, Play/Перемішати/Змінити, «⋯» (у чергу, видалити), таблиця з перетягуванням. */
export function PlaylistPage({ id, state, perms }: { id: number; state: GuildState; perms: Perms }) {
  const lib = useLibrary();
  const summary = lib.playlists.find((p) => p.id === id);
  const playlist = useLoad((signal) => api.playlist(id, signal), [id, lib.version]);
  const data = playlist.data;
  // Локальний порядок після перетягування/прибирання — поки сервер не підтвердить новим завантаженням.
  const [local, setLocal] = useState<PlaylistEntry[] | null>(null);
  useEffect(() => setLocal(null), [data]);
  const tracks = local ?? data?.tracks ?? [];

  if (playlist.error && !data && !summary) {
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

  const name = summary?.name ?? data?.name ?? "";
  const count = local ? local.length : (summary?.track_count ?? data?.track_count ?? 0);
  const duration = summary?.duration ?? data?.duration ?? 0;

  const reorder = (from: number, to: number) => {
    const moved = tracks[from];
    if (!moved) return;
    const next = [...tracks];
    next.splice(to, 0, ...next.splice(from, 1));
    setLocal(next);
    void library.reorder(id, moved.entry_id, to);
  };

  const remove = (entry: PlaylistEntry) => {
    setLocal(tracks.filter((t) => t.entry_id !== entry.entry_id));
    void library.removeFromPlaylist(id, entry.entry_id, entry.title);
  };

  return (
    <>
      <Hero
        label="Плейлист"
        labelIcon={<ListMusic />}
        art={
          <LibraryHeroArt>
            <PlaylistCover cover={summary?.cover ?? data?.cover ?? []} className="size-full" rounded="" />
          </LibraryHeroArt>
        }
        title={name || " "}
        subtitle={`${plural(count, "трек", "треки", "треків")}${duration ? ` · ${fmtTotal(duration)}` : ""}`}
        actions={
          <ListActions perms={perms} count={count} play={(o) => void playPlaylist(id, name, o)}>
            <Pill variant="gray" onClick={() => openDialog({ kind: "rename-playlist", id, name })}>
              <Pencil className="size-4" /> Змінити
            </Pill>
            <MenuButton
              label="Ще дії з плейлистом"
              variant="pill"
              items={[
                {
                  label: "Додати все в чергу",
                  icon: <ListEnd />,
                  disabled: !perms.canAdd || count === 0,
                  title: perms.canAdd ? undefined : (perms.hint ?? undefined),
                  onSelect: () => void playPlaylist(id, name, { mode: "queue" }),
                },
                {
                  label: "Видалити плейлист",
                  icon: <Trash2 />,
                  danger: true,
                  onSelect: () => openDialog({ kind: "delete-playlist", id, name, count }),
                },
              ]}
            />
          </ListActions>
        }
      />
      <div className="border-t border-line pb-8">
        <TrackTable
          tracks={tracks}
          state={state}
          perms={perms}
          loading={playlist.loading && !data}
          onReorder={tracks.length > 1 ? reorder : undefined}
          extraMenu={(track) => [{ label: "Прибрати з плейлиста", icon: <ListX />, danger: true, onSelect: () => remove(track) }]}
          empty={
            <div className="pt-8">
              <TableEmpty
                icon={<ListMusic />}
                title="У плейлисті ще нема треків"
                text="Додавай треки через «⋯ → У плейлист» у пошуку, улюблених чи на головній."
                action={
                  <Pill variant="gray" size="sm" onClick={() => router.go({ name: "search" })}>
                    Знайти трек
                  </Pill>
                }
              />
            </div>
          }
        />
      </div>
    </>
  );
}

/** Профіль: аватар, статистика, «Видалити мої дані». */
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
        art={<Avatar src={me?.avatar ?? state.you.avatar} name={name} className="size-28 text-4xl tall:size-32 lg:tall:size-40" />}
        title={name}
        subtitle={me?.created_at ? `В Adolfik з ${fmtDate(me.created_at)}` : "Акаунт Discord"}
      />
      {lib.me && !lib.ready ? (
        <Unavailable />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4 pb-8 sm:px-8 lg:grid-cols-4">
            <Stat label="В улюблених" value={stats?.likes} onClick={() => router.go({ name: "likes" })} />
            <Stat label="Плейлистів" value={stats?.playlists} onClick={() => router.go({ name: "library" })} />
            <Stat label="Треків у плейлистах" value={stats?.playlist_tracks} />
            <Stat label="Увімкнено треків" value={stats?.plays} />
          </div>

          <section className="mx-4 mb-10 rounded-xl border border-white/[0.06] bg-side p-5 sm:mx-8">
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="size-4 text-dim" /> Мої дані
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
              Профіль створюється автоматично з твого акаунта Discord (ім'я та аватар). Лайки й плейлисти приватні — їх бачиш
              лише ти. Можеш будь-коли видалити все це назавжди; запит на видалення можна також надіслати через GitHub Issues
              репозиторію бота.
            </p>
            <button
              type="button"
              onClick={() => openDialog({ kind: "delete-data" })}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-full border border-heart/60 px-4 text-[13px] font-semibold text-[#ff6b5e] transition hover:border-heart hover:bg-heart/10"
            >
              <Trash2 className="size-4" /> Видалити мої дані
            </button>
          </section>
        </>
      )}
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

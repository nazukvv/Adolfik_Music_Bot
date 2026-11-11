import { Headphones, Play } from "lucide-react";
import type { ReactNode } from "react";
import { fmtTotal, plural } from "../../lib/format";
import { useLibrary } from "../../lib/library";
import { type Perms, playLabel } from "../../lib/perms";
import { router } from "../../lib/router";
import { LikesCover, PlaylistCover } from "../ui/Bits";

/** Картка плейлиста: квадратна обкладинка, назва, «N треків»; на ховері — зелена кнопка ▶. */
export function PlaylistCard({
  art,
  title,
  subtitle,
  onOpen,
  onPlay,
  perms,
}: {
  art: ReactNode;
  title: string;
  subtitle: string;
  onOpen: () => void;
  onPlay?: () => void;
  perms: Perms;
}) {
  return (
    <div className="group relative w-full min-w-0 rounded-xl p-2.5 transition-colors hover:bg-white/[0.05]">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-square w-full overflow-hidden rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.5)]">{art}</div>
        <p className="mt-2.5 truncate text-[13px] font-semibold">{title}</p>
        <p className="mt-0.5 truncate text-xs text-dim">{subtitle}</p>
      </button>
      {onPlay && (
        <button
          type="button"
          onClick={onPlay}
          disabled={!perms.canAdd}
          aria-label={playLabel(perms, `Грати «${title}»`)}
          title={perms.canAdd ? playLabel(perms, `Грати «${title}»`) : (perms.hint ?? "")}
          className="absolute right-4 bottom-[4.25rem] grid size-11 translate-y-2 place-items-center rounded-full bg-green text-white opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105 disabled:hidden touch:hidden"
        >
          {perms.needsSummon ? <Headphones className="size-5" /> : <Play className="ml-0.5 size-5 fill-current" />}
        </button>
      )}
    </div>
  );
}

/** Сітка карток: «Улюблені» першими, далі плейлисти користувача. */
export function PlaylistGrid({
  perms,
  limit,
  onPlayLikes,
  onPlayPlaylist,
}: {
  perms: Perms;
  limit?: number;
  onPlayLikes: () => void;
  onPlayPlaylist: (id: number, name: string) => void;
}) {
  const lib = useLibrary();
  const playlists = limit ? lib.playlists.slice(0, limit) : lib.playlists;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1 px-2 sm:px-6">
      <PlaylistCard
        art={<LikesCover className="size-full" rounded="" />}
        title="Улюблені"
        subtitle={plural(lib.liked.size, "трек", "треки", "треків")}
        onOpen={() => router.go({ name: "likes" })}
        onPlay={lib.liked.size ? onPlayLikes : undefined}
        perms={perms}
      />
      {playlists.map((playlist) => (
        <PlaylistCard
          key={playlist.id}
          art={<PlaylistCover cover={playlist.cover} className="size-full" rounded="" />}
          title={playlist.name}
          subtitle={`${plural(playlist.track_count, "трек", "треки", "треків")}${playlist.duration ? ` · ${fmtTotal(playlist.duration)}` : ""}`}
          onOpen={() => router.go({ name: "playlist", id: playlist.id })}
          onPlay={playlist.track_count ? () => onPlayPlaylist(playlist.id, playlist.name) : undefined}
          perms={perms}
        />
      ))}
    </div>
  );
}

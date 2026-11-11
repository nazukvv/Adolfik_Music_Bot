import { Heart, ListMusic } from "lucide-react";
import { library, useLibrary } from "../../lib/library";
import type { Track } from "../../lib/types";
import { Cover } from "../Cover";

/** Анімований зелений еквалайзер (замість номера в рядку, що грає). */
export function Equalizer({ paused = false, className = "" }: { paused?: boolean; className?: string }) {
  return (
    <span className={`eq flex h-3.5 items-end gap-[2px] ${paused ? "paused" : ""} ${className}`} aria-label="Грає зараз">
      <span className="h-full" />
      <span className="h-full" />
      <span className="h-full" />
      <span className="h-full" />
    </span>
  );
}

/** ❤: червоне заповнене — в улюблених, контур — ні. */
export function LikeButton({ track, size = "md", className = "" }: { track: Pick<Track, "id" | "title">; size?: "sm" | "md"; className?: string }) {
  const { ready, liked } = useLibrary();
  if (!ready) return null;
  const on = liked.has(track.id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void library.toggleLike(track);
      }}
      aria-pressed={on}
      aria-label={on ? "Прибрати з улюблених" : "В улюблені"}
      title={on ? "Прибрати з улюблених" : "В улюблені"}
      className={`grid shrink-0 place-items-center rounded-full transition active:scale-90 ${size === "md" ? "size-10" : "size-8"} ${
        on ? "text-heart" : "text-dim hover:text-white"
      } ${className}`}
    >
      <Heart className={size === "md" ? "size-[18px]" : "size-4"} fill={on ? "currentColor" : "none"} strokeWidth={on ? 0 : 2} />
    </button>
  );
}

/** Обкладинка плейлиста: колаж 2×2 з перших 4 різних треків (або одна, якщо їх менше). */
export function PlaylistCover({ cover, className = "", rounded = "rounded-xl" }: { cover: string[]; className?: string; rounded?: string }) {
  if (cover.length >= 4) {
    return (
      <div className={`grid grid-cols-2 grid-rows-2 overflow-hidden bg-hover ${rounded} ${className}`}>
        {cover.slice(0, 4).map((src) => (
          <Cover key={src} src={src} className="size-full" rounded="" />
        ))}
      </div>
    );
  }
  if (cover.length > 0) return <Cover src={cover[0]} className={className} rounded={rounded} />;
  return (
    <div className={`grid place-items-center bg-gradient-to-br from-[#2a2a2a] to-[#141414] ${rounded} ${className}`}>
      <ListMusic className="size-1/3 text-white/40" />
    </div>
  );
}

/** «Обкладинка» Улюблених: червоно-темний градієнт із серцем. */
export function LikesCover({ className = "", rounded = "rounded-xl" }: { className?: string; rounded?: string }) {
  return (
    <div className={`grid place-items-center bg-gradient-to-br from-heart/90 via-[#5a0d08] to-[#140504] ${rounded} ${className}`}>
      <Heart className="size-2/5 text-white" fill="currentColor" strokeWidth={0} />
    </div>
  );
}

/** Аватар Discord (або перша літера імені). */
export function Avatar({ src, name, className = "size-8" }: { src: string | null | undefined; name: string | null | undefined; className?: string }) {
  if (src) return <Cover src={src} alt="" className={`shrink-0 ${className}`} rounded="rounded-full" />;
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-pill text-xs font-semibold ${className}`}>
      {(name ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

import { Headphones, ListEnd, ListPlus, Play } from "lucide-react";
import type { ReactNode } from "react";
import { playTrack } from "../../lib/actions";
import { fmtTime } from "../../lib/format";
import { type Perms, playLabel } from "../../lib/perms";
import type { GuildState, Track } from "../../lib/types";
import { Cover } from "../Cover";
import { Equalizer, LikeButton } from "./Bits";
import { type MenuItem, MenuButton } from "./Menu";

interface Props<T extends Track> {
  tracks: T[];
  state: GuildState;
  perms: Perms;
  /** Додаткова колонка (наприклад, коли грало і хто замовив) — видно на широких екранах. */
  aside?: (track: T) => ReactNode;
  /** Додаткові пункти меню «⋯» (етап 3: У плейлист, Прибрати). */
  extraMenu?: (track: T, index: number) => MenuItem[];
  loading?: boolean;
  empty?: ReactNode;
}

/** Таблиця треків із референсу: «# N», обкладинка, назва, канал, тривалість, ❤ і «⋯». */
export function TrackTable<T extends Track>({ tracks, state, perms, aside, extraMenu, loading, empty }: Props<T>) {
  if (loading && tracks.length === 0) return <TableSkeleton />;
  if (tracks.length === 0) return <>{empty}</>;
  const player = state.player;
  return (
    <div role="table" className="px-2 sm:px-6">
      {tracks.map((track, index) => (
        <TrackRow
          key={track.key}
          track={track}
          index={index}
          perms={perms}
          playing={player?.current?.id === track.id}
          paused={!!player?.paused || !!player?.preparing}
          aside={aside?.(track)}
          extraMenu={extraMenu?.(track, index) ?? []}
        />
      ))}
    </div>
  );
}

function TrackRow({
  track,
  index,
  perms,
  playing,
  paused,
  aside,
  extraMenu,
}: {
  track: Track;
  index: number;
  perms: Perms;
  playing: boolean;
  paused: boolean;
  aside: ReactNode;
  extraMenu: MenuItem[];
}) {
  const label = playLabel(perms, "Грати зараз");
  const blocked = perms.canAdd ? undefined : (perms.hint ?? undefined);
  const menu: MenuItem[] = [
    {
      label,
      icon: perms.needsSummon ? <Headphones /> : <Play />,
      onSelect: () => void playTrack(track, "now"),
      disabled: !perms.canAdd,
      title: blocked,
    },
    { label: "Наступним", icon: <ListEnd />, onSelect: () => void playTrack(track, "next"), disabled: !perms.canAdd, title: blocked },
    { label: "У чергу", icon: <ListPlus />, onSelect: () => void playTrack(track, "queue"), disabled: !perms.canAdd, title: blocked },
    ...extraMenu,
  ];

  return (
    <div
      role="row"
      onDoubleClick={() => perms.canAdd && void playTrack(track, "now")}
      className="group flex h-[65px] items-center gap-2 border-b border-line px-2 transition-colors hover:bg-white/[0.035] sm:gap-3"
    >
      <div className="relative grid w-9 shrink-0 place-items-center text-[13px] text-dim tabular-nums">
        {playing ? (
          <Equalizer paused={paused} className="group-hover:hoverable:hidden" />
        ) : (
          <span className="group-hover:hoverable:hidden"># {index + 1}</span>
        )}
        <button
          type="button"
          disabled={!perms.canAdd}
          onClick={() => void playTrack(track, "now")}
          aria-label={label}
          title={blocked ?? label}
          className="absolute inset-0 m-auto hidden size-8 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 group-hover:hoverable:grid"
        >
          {perms.needsSummon ? <Headphones className="size-4" /> : <Play className="size-4 fill-current" />}
        </button>
      </div>

      <Cover src={track.thumbnail_small} alt="" className="size-8 shrink-0 sm:size-9" rounded="rounded-md" />

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${playing ? "text-green" : "text-white"}`} title={track.title}>
          {track.title}
        </p>
        <p className="truncate text-xs text-dim @3xl:hidden">{track.channel ?? "—"}</p>
      </div>

      <p className="hidden w-[24%] shrink-0 truncate text-[13px] text-dim @3xl:block">{track.channel ?? "—"}</p>
      {aside !== undefined && <div className="hidden w-36 shrink-0 text-xs text-dim @4xl:block">{aside}</div>}
      <span className="hidden w-14 shrink-0 text-right text-[13px] text-dim tabular-nums @md:block">
        {track.is_live ? "LIVE" : fmtTime(track.duration)}
      </span>
      <LikeButton track={track} size="sm" />
      <MenuButton items={menu} label="Дії з треком" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="px-2 sm:px-6" aria-busy>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-[65px] animate-pulse items-center gap-3 border-b border-line px-2">
          <div className="h-3 w-9 rounded bg-white/[0.05]" />
          <div className="size-9 rounded-md bg-white/[0.07]" />
          <div className="flex-1">
            <div className="h-3.5 w-2/5 rounded bg-white/[0.07]" />
            <div className="mt-2 h-3 w-1/4 rounded bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Порожній список усередині сторінки. */
export function TableEmpty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-4 flex flex-col items-center rounded-xl border border-dashed border-white/10 px-6 py-10 text-center sm:mx-8">
      <div className="mb-3 text-dim [&>svg]:size-8">{icon}</div>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-dim">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

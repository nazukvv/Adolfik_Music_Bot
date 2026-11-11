import {
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { control, seek } from "../../lib/actions";
import { fmtTime } from "../../lib/format";
import type { Perms } from "../../lib/perms";
import { usePosition } from "../../lib/store";
import type { GuildState, PlayerState } from "../../lib/types";
import { Cover } from "../Cover";
import { IconButton } from "../ui/Buttons";
import { LikeButton } from "../ui/Bits";

/**
 * Плеєр унизу центральної колонки (≥768px): ❤, гучність, ⏮, велика біла ⏯, ⏭, повтор, shuffle;
 * під ним тонкий прогрес із часом. Ліворуч — трек, коли права панель схована.
 */
export function PlayerBar({
  state,
  perms,
  showTrack,
  panelOpen,
  onTogglePanel,
}: {
  state: GuildState;
  perms: Perms;
  showTrack: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const player = state.player;
  const current = player?.current ?? null;

  return (
    <footer className="shrink-0 border-t border-line bg-main px-4 pt-3 pb-3 lg:px-8">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <div className="min-w-0">{showTrack && current && <TrackInfo state={state} />}</div>
        <Controls state={state} perms={perms} withLike />
        <div className="flex justify-end">
          <IconButton
            label={panelOpen ? "Сховати чергу" : "Черга і зараз грає"}
            active={panelOpen}
            onClick={onTogglePanel}
          >
            <ListMusic className="size-[18px]" />
          </IconButton>
        </div>
      </div>
      <SeekBar player={player} enabled={perms.canControl && !!current} className="mx-auto mt-1.5 max-w-[680px]" />
    </footer>
  );
}

function TrackInfo({ state }: { state: GuildState }) {
  const current = state.player?.current;
  if (!current) return null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Cover src={current.thumbnail_small} alt={current.title} className="size-11 shrink-0" rounded="rounded-md" />
      {/* На планшеті центральна колонка вузька — там лише обкладинка */}
      <div className="hidden min-w-0 lg:block">
        <p className="truncate text-[13px] font-semibold">{current.title}</p>
        <p className="truncate text-xs text-dim">{current.channel ?? "—"}</p>
      </div>
    </div>
  );
}

/** Ряд кнопок плеєра. */
export function Controls({ state, perms, withLike = false, big = false }: { state: GuildState; perms: Perms; withLike?: boolean; big?: boolean }) {
  const player = state.player;
  const current = player?.current ?? null;
  const can = perms.canControl && !!current;

  return (
    <div className={`flex items-center ${big ? "justify-between" : "gap-1 lg:gap-2"}`}>
      {withLike && (current ? <LikeButton track={current} /> : <span className="size-10" />)}
      {!big && <VolumeButton volume={player?.volume ?? 50} disabled={!perms.canControl || !player} />}
      <IconButton label="Спочатку" disabled={!can || !!current?.is_live} onClick={() => void control({ action: "previous_restart" })}>
        <SkipBack className="size-5 fill-current" />
      </IconButton>
      <PlayPause player={player} disabled={!can} big={big} />
      <IconButton label="Наступний" disabled={!can} onClick={() => void control({ action: "skip" })}>
        <SkipForward className="size-5 fill-current" />
      </IconButton>
      <IconButton
        label={loopLabel(player)}
        disabled={!perms.canControl || !player}
        active={!!player && player.loop !== "off"}
        onClick={() => void control({ action: "loop" })}
      >
        {player?.loop === "track" ? <Repeat1 className="size-[18px]" /> : <Repeat className="size-[18px]" />}
      </IconButton>
      <IconButton
        label="Перемішати чергу"
        disabled={!perms.canControl || !player || player.queue_total < 2}
        onClick={() => void control({ action: "shuffle" })}
      >
        <Shuffle className="size-[18px]" />
      </IconButton>
    </div>
  );
}

/** Велика біла кругла ⏯ з темною іконкою. */
export function PlayPause({ player, disabled, big = false, small = false }: { player: PlayerState | null; disabled: boolean; big?: boolean; small?: boolean }) {
  const size = small ? "size-9" : big ? "size-16" : "size-12";
  const icon = small ? "size-4" : big ? "size-7" : "size-5";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        void control({ action: "toggle" });
      }}
      aria-label={player?.paused ? "Грати" : "Пауза"}
      title={player?.paused ? "Грати" : "Пауза"}
      className={`mx-1 grid shrink-0 place-items-center rounded-full bg-white text-[#111] shadow-lg transition hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 ${size}`}
    >
      {player?.preparing ? (
        <LoaderCircle className={`${icon} animate-spin`} />
      ) : player?.paused || !player?.current ? (
        <Play className={`ml-0.5 ${icon} fill-current`} />
      ) : (
        <Pause className={`${icon} fill-current`} />
      )}
    </button>
  );
}

function loopLabel(player: PlayerState | null): string {
  if (player?.loop === "track") return "Повтор: трек";
  if (player?.loop === "queue") return "Повтор: вся черга";
  return "Повтор вимкнено";
}

/** Тонкий прогрес: доріжка #515151, біле заповнення, без кружечка; час ліворуч і праворуч. */
export function SeekBar({ player, enabled, className = "" }: { player: PlayerState | null; enabled: boolean; className?: string }) {
  const position = usePosition(4);
  const [drag, setDrag] = useState<number | null>(null);
  // Значення під час перетягування дублюємо в ref: pointerup може прийти раніше, ніж React перемалює
  // компонент, і замикання ще бачило б drag = null.
  const dragRef = useRef<number | null>(null);
  const current = player?.current;
  const duration = current && !current.is_live ? (current.duration ?? 0) : 0;
  const value = drag ?? (current ? position : 0);
  const pct = duration ? Math.min(100, (value / duration) * 100) : current?.is_live ? 100 : 0;
  const canSeek = enabled && !!player?.can_seek && duration > 0;

  const commit = () => {
    const target = dragRef.current;
    if (target == null) return;
    dragRef.current = null;
    setDrag(null);
    void seek(target);
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="w-11 shrink-0 text-right text-[11px] text-dim tabular-nums">{current ? fmtTime(value) : "0:00"}</span>
      <div className="flex h-4 flex-1 items-center">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={1}
          value={Math.min(value, duration || 1)}
          disabled={!canSeek}
          aria-label="Позиція треку"
          onChange={(e) => {
            dragRef.current = Number(e.target.value);
            setDrag(dragRef.current);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          style={{ "--fill": `${pct}%` } as CSSProperties}
          className="seekbar w-full"
        />
      </div>
      <span className="w-11 shrink-0 text-[11px] text-dim tabular-nums">
        {current?.is_live ? "LIVE" : current ? fmtTime(duration) : "0:00"}
      </span>
    </div>
  );
}

/** Гучність: іконка (клік — вимкнути/увімкнути звук) і повзунок у поповері над нею. */
export function VolumeButton({ volume, disabled }: { volume: number; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastAudible = useRef(volume || 50);
  const wrap = useRef<HTMLDivElement>(null);
  const value = local ?? volume;

  useEffect(() => {
    if (volume > 0) lastAudible.current = volume;
  }, [volume]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const send = (v: number, delay = 220) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void control({ action: "volume", value: v }).finally(() => setLocal(null));
    }, delay);
  };

  const Icon = value === 0 ? VolumeX : value < 50 ? Volume1 : Volume2;
  return (
    <div ref={wrap} className="relative" onMouseEnter={() => !disabled && setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <IconButton label={`Гучність ${value}%`} disabled={disabled} onClick={() => setOpen(true)}>
        <Icon className="size-[18px]" />
      </IconButton>
      <AnimatePresence>
        {open && !disabled && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-1/2 z-40 -translate-x-1/2 pb-2"
          >
            <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-raise px-3 py-2 shadow-2xl">
              <button
                type="button"
                onClick={() => {
                  const next = value === 0 ? lastAudible.current : 0;
                  setLocal(next);
                  send(next, 0);
                }}
                aria-label={value === 0 ? "Увімкнути звук" : "Вимкнути звук"}
                className="text-dim hover:text-white"
              >
                <Icon className="size-4" />
              </button>
              <input
                type="range"
                min={0}
                max={150}
                step={5}
                value={value}
                aria-label="Гучність"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLocal(v);
                  send(v);
                }}
                style={{ "--fill": `${(value / 150) * 100}%` } as CSSProperties}
                className="slider w-28"
              />
              <span className="w-9 text-right text-[11px] text-dim tabular-nums">{value}%</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Компактний плеєр над нижньою навігацією (<768px); тап відкриває «Зараз грає». */
export function MobilePlayer({ state, perms, onOpen }: { state: GuildState; perms: Perms; onOpen: () => void }) {
  const player = state.player;
  const current = player?.current ?? null;
  if (!current) return null;
  return (
    <div className="shrink-0 px-2 pb-1.5">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
        className="relative flex items-center gap-3 overflow-hidden rounded-xl bg-[#1c1c1c] p-2 pr-2.5"
      >
        <Cover src={current.thumbnail_small} className="size-10 shrink-0" rounded="rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{current.title}</p>
          <p className="truncate text-xs text-dim">{current.channel ?? "—"}</p>
        </div>
        <LikeButton track={current} size="sm" />
        <PlayPause player={player} disabled={!perms.canControl} small />
        <MiniProgress player={player} />
      </div>
    </div>
  );
}

function MiniProgress({ player }: { player: PlayerState | null }) {
  const position = usePosition(2);
  const current = player?.current;
  const duration = current && !current.is_live ? (current.duration ?? 0) : 0;
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-track">
      <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
    </div>
  );
}

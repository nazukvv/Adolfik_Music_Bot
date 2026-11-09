import {
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
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { control, seek } from "../lib/actions";
import { fmtTime } from "../lib/format";
import type { Perms } from "../lib/perms";
import { usePosition } from "../lib/store";
import type { GuildState, PlayerState } from "../lib/types";
import { Cover } from "./Cover";

interface Props {
  state: GuildState;
  perms: Perms;
}

export function MiniPlayer({ state, perms }: Props) {
  const player = state.player;
  const current = player?.current ?? null;
  const can = perms.canControl && !!current;

  return (
    <footer className="relative z-20 shrink-0 border-t border-white/[0.06] bg-base/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl">
      <Progress player={player} enabled={perms.canControl} />
      <div className="grid h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Cover src={current?.thumbnail_small} className="h-12 w-[84px] shrink-0 shadow-lg" rounded="rounded-lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{current?.title ?? "Нічого не грає"}</p>
            <p className="truncate text-xs text-dim">
              {current ? (current.channel ?? "—") : state.voice_channel ? "Обери трек у пошуку" : "Бот не в голосовому каналі"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <IconButton
            label="Спочатку"
            disabled={!can || !!current?.is_live}
            onClick={() => void control({ action: "previous_restart" })}
          >
            <SkipBack className="size-5 fill-current" />
          </IconButton>
          <button
            type="button"
            disabled={!can}
            onClick={() => void control({ action: "toggle" })}
            aria-label={player?.paused ? "Грати" : "Пауза"}
            className="grid size-11 place-items-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            {player?.preparing ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : player?.paused || !current ? (
              <Play className="ml-0.5 size-5 fill-current" />
            ) : (
              <Pause className="size-5 fill-current" />
            )}
          </button>
          <IconButton label="Наступний" disabled={!can} onClick={() => void control({ action: "skip" })}>
            <SkipForward className="size-5 fill-current" />
          </IconButton>
        </div>

        <div className="hidden min-w-0 items-center justify-end gap-1 sm:flex">
          <TimeLabel player={player} />
          <PlayerExtras player={player} enabled={perms.canControl} />
        </div>
      </div>
    </footer>
  );
}

/** Повтор, shuffle і гучність (у міні-плеєрі, а на телефоні — у «Зараз грає»). */
export function PlayerExtras({
  player,
  enabled,
  className = "",
}: {
  player: PlayerState | null;
  enabled: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <IconButton
        label={loopLabel(player)}
        disabled={!enabled || !player}
        active={!!player && player.loop !== "off"}
        onClick={() => void control({ action: "loop" })}
      >
        {player?.loop === "track" ? <Repeat1 className="size-[18px]" /> : <Repeat className="size-[18px]" />}
      </IconButton>
      <IconButton
        label="Перемішати чергу"
        disabled={!enabled || !player || player.queue_total < 2}
        onClick={() => void control({ action: "shuffle" })}
      >
        <Shuffle className="size-[18px]" />
      </IconButton>
      <VolumeControl volume={player?.volume ?? 50} disabled={!enabled || !player} />
    </div>
  );
}

function loopLabel(player: PlayerState | null): string {
  if (player?.loop === "track") return "Повтор: трек";
  if (player?.loop === "queue") return "Повтор: вся черга";
  return "Повтор вимкнено";
}

export function IconButton({
  label,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative grid size-10 place-items-center rounded-full transition hover:bg-white/10 active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent ${
        active ? "text-[var(--accent)]" : "text-white/85"
      }`}
    >
      {children}
      {active && <span className="absolute bottom-1 size-1 rounded-full bg-[var(--accent)]" />}
    </button>
  );
}

function TimeLabel({ player }: { player: PlayerState | null }) {
  const position = usePosition(4);
  const current = player?.current;
  if (!current) return null;
  return (
    <span className="mr-2 hidden text-xs text-dim tabular-nums lg:inline">
      {current.is_live ? `🔴 ${fmtTime(position)}` : `${fmtTime(position)} / ${fmtTime(current.duration)}`}
    </span>
  );
}

/** Прогрес над плеєром. Позиція інтерполюється локально між оновленнями WS. */
export function Progress({ player, enabled, inline = false }: { player: PlayerState | null; enabled: boolean; inline?: boolean }) {
  const position = usePosition(inline ? 4 : 10);
  const [drag, setDrag] = useState<number | null>(null);
  // Значення під час перетягування дублюємо в ref: pointerup може прийти раніше, ніж React
  // перемалює компонент, і замикання ще бачило б drag = null (перемотування губилось або
  // спрацьовувало пізніше — при втраті фокуса).
  const dragRef = useRef<number | null>(null);
  const current = player?.current;
  const duration = current && !current.is_live ? (current.duration ?? 0) : 0;
  const value = drag ?? position;
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
    <div className={inline ? "flex items-center gap-3" : "absolute inset-x-0 -top-[3px] h-[6px]"}>
      {inline && <span className="w-10 text-right text-[11px] text-dim tabular-nums">{fmtTime(value)}</span>}
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
        className={`slider w-full ${inline ? "" : "block"} ${current?.is_live ? "opacity-70" : ""}`}
      />
      {inline && (
        <span className="w-10 text-[11px] text-dim tabular-nums">{current?.is_live ? "LIVE" : fmtTime(duration)}</span>
      )}
    </div>
  );
}

/** Гучність: локальне значення під час перетягування, на сервер — з дебаунсом. */
export function VolumeControl({ volume, disabled }: { volume: number; disabled: boolean }) {
  const [local, setLocal] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastAudible = useRef(volume || 50);
  const value = local ?? volume;

  useEffect(() => {
    if (volume > 0) lastAudible.current = volume;
  }, [volume]);

  const send = (v: number, delay = 220) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void control({ action: "volume", value: v }).finally(() => setLocal(null));
    }, delay);
  };

  const Icon = value === 0 ? VolumeX : value < 50 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-1">
      <IconButton
        label={value === 0 ? "Увімкнути звук" : "Вимкнути звук"}
        disabled={disabled}
        onClick={() => {
          const next = value === 0 ? lastAudible.current : 0;
          setLocal(next);
          send(next, 0);
        }}
      >
        <Icon className="size-[18px]" />
      </IconButton>
      <input
        type="range"
        min={0}
        max={150}
        step={5}
        value={value}
        disabled={disabled}
        aria-label="Гучність"
        title={`Гучність ${value}%`}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          send(v);
        }}
        style={{ "--fill": `${(value / 150) * 100}%` } as CSSProperties}
        className="slider w-24"
      />
    </div>
  );
}

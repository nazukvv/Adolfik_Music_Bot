import { Headphones, LoaderCircle, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { control, summon } from "../lib/actions";
import type { Perms } from "../lib/perms";
import type { GuildState } from "../lib/types";
import { Cover } from "./Cover";
import { IconButton, Progress } from "./MiniPlayer";

/** Маленьке вікно Activity (картинка-в-картинці): лише обкладинка, назва, кнопки й прогрес. */
export function CompactPlayer({ state, perms }: { state: GuildState; perms: Perms }) {
  const player = state.player;
  const current = player?.current ?? null;
  const can = perms.canControl && !!current;

  return (
    <div className="flex h-full items-center gap-4 p-3">
      <Cover src={current?.thumbnail} fallbackSrc={current?.thumbnail_small} className="aspect-video h-full max-h-40 shrink-0 shadow-2xl" rounded="rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{current?.title ?? (state.voice_channel ? "Нічого не грає" : "Бот не у войсі")}</p>
          <p className="truncate text-xs text-dim">{current?.channel ?? state.voice_channel?.name ?? "—"}</p>
        </div>
        {current ? (
          <>
            <Progress player={player} enabled={perms.canControl} inline />
            <div className="flex items-center gap-1">
              <IconButton label="Спочатку" disabled={!can || current.is_live} onClick={() => void control({ action: "previous_restart" })}>
                <SkipBack className="size-4 fill-current" />
              </IconButton>
              <button
                type="button"
                disabled={!can}
                onClick={() => void control({ action: "toggle" })}
                aria-label={player?.paused ? "Грати" : "Пауза"}
                className="grid size-9 place-items-center rounded-full bg-white text-black disabled:opacity-40"
              >
                {player?.preparing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : player?.paused ? (
                  <Play className="ml-0.5 size-4 fill-current" />
                ) : (
                  <Pause className="size-4 fill-current" />
                )}
              </button>
              <IconButton label="Наступний" disabled={!can} onClick={() => void control({ action: "skip" })}>
                <SkipForward className="size-4 fill-current" />
              </IconButton>
            </div>
          </>
        ) : (
          perms.canSummon &&
          perms.summonChannel && (
            <button
              type="button"
              onClick={() => void summon(perms.summonChannel!)}
              className="inline-flex w-fit items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-black"
            >
              <Headphones className="size-4" /> Покликати бота
            </button>
          )
        )}
      </div>
    </div>
  );
}

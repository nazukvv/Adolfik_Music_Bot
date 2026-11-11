import { Headphones, SkipBack, SkipForward } from "lucide-react";
import { control, summon } from "../lib/actions";
import type { Perms } from "../lib/perms";
import type { GuildState } from "../lib/types";
import { Cover } from "./Cover";
import { PlayPause, SeekBar } from "./layout/Player";
import { IconButton } from "./ui/Buttons";

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
            <SeekBar player={player} enabled={perms.canControl} />
            <div className="flex items-center gap-1">
              <IconButton label="Спочатку" size="sm" disabled={!can || current.is_live} onClick={() => void control({ action: "previous_restart" })}>
                <SkipBack className="size-4 fill-current" />
              </IconButton>
              <PlayPause player={player} disabled={!can} small />
              <IconButton label="Наступний" size="sm" disabled={!can} onClick={() => void control({ action: "skip" })}>
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
              className="inline-flex w-fit items-center gap-2 rounded-full bg-green px-4 py-1.5 text-sm font-semibold text-white"
            >
              <Headphones className="size-4" /> Покликати бота
            </button>
          )
        )}
      </div>
    </div>
  );
}

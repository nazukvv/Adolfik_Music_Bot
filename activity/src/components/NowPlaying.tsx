import { Disc3, Headphones, LoaderCircle, MicVocal, Pause, Radio } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { summon } from "../lib/actions";
import { media } from "../lib/media";
import type { Perms } from "../lib/perms";
import type { GuildState } from "../lib/types";
import { Cover } from "./Cover";
import { EmptyState, PrimaryButton } from "./EmptyState";
import { PlayerExtras } from "./MiniPlayer";
import { QueueList } from "./QueueList";

interface Props {
  state: GuildState;
  perms: Perms;
}

export function NowPlaying({ state, perms }: Props) {
  const player = state.player;
  const current = player?.current ?? null;

  if (!state.voice_channel) {
    return (
      <EmptyState
        className="pt-16"
        icon={<Headphones />}
        title="Бот зараз не в голосовому каналі"
        text={
          perms.canSummon
            ? "Поклич його сюди — і музика заграє для всіх у каналі."
            : "Зайди в голосовий канал, і тут з'явиться кнопка, щоб покликати бота."
        }
        action={
          perms.canSummon && perms.summonChannel ? (
            <PrimaryButton onClick={() => void summon(perms.summonChannel!)}>
              <Headphones className="size-4" /> Покликати бота сюди
            </PrimaryButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 p-5">
      {current ? (
        <div>
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-[var(--accent)] opacity-25 blur-3xl transition-colors duration-1000" />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={current.key}
                initial={{ opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.03 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="relative"
              >
                <Cover src={current.thumbnail} fallbackSrc={current.thumbnail_small} alt={current.title} className="aspect-video w-full shadow-2xl" rounded="rounded-2xl" />
              </motion.div>
            </AnimatePresence>
            <AnimatePresence>
              {(player?.preparing || player?.paused) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 grid place-items-center rounded-2xl bg-black/45 backdrop-blur-[1px]"
                >
                  <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium">
                    {player.preparing ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" /> Готую трек…
                      </>
                    ) : (
                      <>
                        <Pause className="size-4 fill-current" /> На паузі
                      </>
                    )}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-5">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-[var(--accent)] uppercase transition-colors duration-700">
              {current.is_live ? <Radio className="size-3.5" /> : <Equalizer paused={!!player?.paused || !!player?.preparing} />}
              {current.is_live ? "Пряма трансляція" : "Зараз грає"}
            </div>
            <h2 className="mt-2 line-clamp-2 text-xl leading-tight font-bold" title={current.title}>
              {current.title}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-dim">
              <MicVocal className="size-3.5 shrink-0" />
              {current.channel ?? "—"}
            </p>
            {current.requester && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pr-3 pl-1 text-xs text-dim">
                {current.requester.avatar ? (
                  <img src={media(current.requester.avatar)} alt="" className="size-5 rounded-full" />
                ) : (
                  <span className="size-5 rounded-full bg-white/10" />
                )}
                Замовив <span className="font-medium text-white">{current.requester.name ?? "хтось"}</span>
              </p>
            )}
            {/* На телефоні в міні-плеєрі нема місця для повтору/shuffle/гучності — вони тут */}
            {player && <PlayerExtras player={player} enabled={perms.canControl} className="mt-4 sm:hidden" />}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Disc3 />}
          title="Тиша в ефірі"
          text={`Бот чекає в «${state.voice_channel.name}». Знайди трек у пошуку й натисни ▶.`}
        />
      )}

      {/* Рядок завжди займає місце, щоб черга не «стрибала», коли напис з'являється чи зникає */}
      {player && (
        <p className="-mt-2 h-4 truncate text-xs text-faint transition-opacity duration-300" style={{ opacity: player.last_action ? 1 : 0 }}>
          {player.last_action ?? ""}
        </p>
      )}
      {perms.hint && (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-dim">{perms.hint}</p>
      )}

      {player && (
        <QueueList
          queue={player.queue}
          total={player.queue_total}
          duration={player.queue_duration}
          canControl={perms.canControl}
        />
      )}
    </div>
  );
}

function Equalizer({ paused }: { paused: boolean }) {
  return (
    <span className={`eq flex h-3 items-end gap-[2px] ${paused ? "paused" : ""}`} aria-hidden>
      <span className="h-full" />
      <span className="h-full" />
      <span className="h-full" />
    </span>
  );
}

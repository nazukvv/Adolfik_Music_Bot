import { ChevronDown, Disc3, Headphones, ListPlus, LoaderCircle, Pause, Radio, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { summon } from "../../lib/actions";
import { openDialog } from "../../lib/dialogs";
import { fmtTime, plural } from "../../lib/format";
import { useLibrary } from "../../lib/library";
import type { Perms } from "../../lib/perms";
import { router } from "../../lib/router";
import type { GuildState } from "../../lib/types";
import { Cover } from "../Cover";
import { Pill } from "../ui/Buttons";
import { Avatar, Equalizer, LikeButton } from "../ui/Bits";
import { Tabs } from "../ui/Hero";
import { Controls, SeekBar, VolumeButton } from "./Player";
import { QueueList } from "./QueueList";

export type PanelTab = "now" | "queue";

interface Props {
  state: GuildState;
  perms: Perms;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
}

/** Права панель ~290px (≥1280px): вкладки «Зараз грає» / «Черга». */
export function RightPanel(props: Props) {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-ink" aria-label="Зараз грає і черга">
      <PanelHeader {...props} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <PanelBody {...props} />
      </div>
    </aside>
  );
}

/** Та сама панель, що виїжджає справа поверх контенту (768–1279px). */
export function RightDrawer({ open, ...props }: Props & { open: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={props.onClose}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-y-0 right-0 z-50 flex w-[320px] max-w-[88vw] flex-col border-l border-line bg-ink shadow-2xl"
            aria-label="Зараз грає і черга"
          >
            <PanelHeader {...props} />
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              <PanelBody {...props} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** На телефоні: повноекранний «Зараз грає» з повним керуванням. */
export function NowPlayingSheet({ open, ...props }: Props & { open: boolean }) {
  const { state, perms } = props;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-50 flex flex-col bg-ink pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          role="dialog"
          aria-label="Зараз грає"
        >
          <div className="flex items-center gap-2 px-3 pt-2">
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Згорнути"
              className="grid size-10 place-items-center rounded-full text-white hover:bg-white/10"
            >
              <ChevronDown className="size-6" />
            </button>
            <div className="flex-1">
              <Tabs
                value={props.tab}
                onChange={props.onTab}
                items={[
                  { value: "now", label: "Зараз грає" },
                  { value: "queue", label: queueLabel(state) },
                ]}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
            {props.tab === "queue" ? (
              <QueueList
                queue={state.player?.queue ?? []}
                total={state.player?.queue_total ?? 0}
                duration={state.player?.queue_duration ?? 0}
                canControl={perms.canControl}
              />
            ) : (
              <NowPlayingCard state={state} perms={perms} large />
            )}
          </div>
          {props.tab === "now" && state.player?.current && (
            <div className="shrink-0 px-5 pb-4">
              <SeekBar player={state.player} enabled={perms.canControl} className="-mx-3" />
              <div className="mt-2 flex items-center justify-between">
                <Controls state={state} perms={perms} big />
              </div>
              <div className="mt-2 flex justify-center">
                <VolumeButton volume={state.player.volume} disabled={!perms.canControl} />
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function queueLabel(state: GuildState): string {
  const total = state.player?.queue_total ?? 0;
  return total ? `Черга · ${total}` : "Черга";
}

function PanelHeader({ state, tab, onTab, onClose }: Props) {
  return (
    <div className="flex h-16 shrink-0 items-end justify-between gap-2 px-1 pb-0">
      <Tabs
        value={tab}
        onChange={onTab}
        items={[
          { value: "now", label: "Зараз грає" },
          { value: "queue", label: queueLabel(state) },
        ]}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Сховати панель"
        title="Сховати панель"
        className="mr-2 mb-2 grid size-8 place-items-center rounded-full text-dim transition hover:bg-white/10 hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function PanelBody({ state, perms, tab, onTab }: Props) {
  const player = state.player;
  if (tab === "queue") {
    return (
      <div className="pt-4">
        <QueueList
          queue={player?.queue ?? []}
          total={player?.queue_total ?? 0}
          duration={player?.queue_duration ?? 0}
          canControl={perms.canControl}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 pt-4">
      {state.voice_channel && <UpNextCard state={state} onShowQueue={() => onTab("queue")} />}
      <NowPlayingCard state={state} perms={perms} />
    </div>
  );
}

/** Картка «Далі в черзі» над «Зараз грає». */
function UpNextCard({ state, onShowQueue }: { state: GuildState; onShowQueue: () => void }) {
  const player = state.player;
  const next = player?.queue[0];
  return (
    <section className="rounded-xl bg-side p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Далі в черзі</h3>
        {player && player.queue_total > 0 && (
          <button type="button" onClick={onShowQueue} className="text-xs text-dim transition hover:text-white">
            Уся черга
          </button>
        )}
      </div>
      {next ? (
        <>
          <div className="mt-3 flex items-center gap-3">
            <Cover src={next.thumbnail_small} className="size-11 shrink-0" rounded="rounded-md" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{next.title}</p>
              <p className="truncate text-xs text-dim">
                {next.channel ?? "—"} · {next.is_live ? "наживо" : fmtTime(next.duration)}
              </p>
            </div>
          </div>
          {player.queue_total > 1 && (
            <p className="mt-2 text-xs text-faint">
              і ще {plural(player.queue_total - 1, "трек", "треки", "треків")} · {fmtTime(player.queue_duration)}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs text-dim">Черга порожня — додай щось із пошуку.</p>
      )}
    </section>
  );
}

/** «Зараз грає»: велика обкладинка з темним градієнтом і заголовком поверх, нижче — трек і хто замовив. */
export function NowPlayingCard({ state, perms, large = false }: { state: GuildState; perms: Perms; large?: boolean }) {
  const lib = useLibrary();
  const player = state.player;
  const current = player?.current ?? null;

  if (!state.voice_channel) {
    return (
      <PanelEmpty
        icon={<Headphones />}
        title="Бот не в голосовому каналі"
        text={perms.canSummon ? "Поклич його — і музика заграє для всіх у твоєму каналі." : "Зайди в голосовий канал, щоб покликати бота."}
        action={
          perms.canSummon && perms.summonChannel ? (
            <Pill variant="green" size="sm" onClick={() => void summon(perms.summonChannel!)}>
              <Headphones className="size-3.5" /> Покликати бота
            </Pill>
          ) : undefined
        }
      />
    );
  }

  if (!current) {
    return (
      <PanelEmpty
        icon={<Disc3 />}
        title="Тиша в ефірі"
        text={`Бот чекає в «${state.voice_channel.name}». Знайди трек і натисни ▶.`}
        action={
          <Pill variant="gray" size="sm" onClick={() => router.go({ name: "search" })}>
            <Search className="size-3.5" /> До пошуку
          </Pill>
        }
      />
    );
  }

  const paused = !!player?.paused || !!player?.preparing;
  return (
    <section className={`overflow-hidden ${large ? "" : "rounded-xl bg-side"}`}>
      <div className={`relative overflow-hidden ${large ? "rounded-2xl" : ""}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={current.key}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <Cover src={current.thumbnail} fallbackSrc={current.thumbnail_small} alt={current.title} className="aspect-square w-full" rounded="" />
          </motion.div>
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-black/70" />
        <p className="absolute inset-x-0 top-4 flex items-center justify-center gap-2 text-[15px] font-semibold">
          {current.is_live ? <Radio className="size-4 text-green" /> : <Equalizer paused={paused} />}
          {current.is_live ? "Пряма трансляція" : "Зараз грає"}
        </p>
        {paused && (
          <span className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3.5 py-1.5 text-xs font-medium">
            {player?.preparing ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" /> Готую трек…
              </>
            ) : (
              <>
                <Pause className="size-3.5 fill-current" /> На паузі
              </>
            )}
          </span>
        )}
      </div>

      <div className={large ? "pt-5" : "p-4"}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className={`line-clamp-2 leading-snug font-bold ${large ? "text-xl" : "text-[15px]"}`} title={current.title}>
              {current.title}
            </h3>
            <p className="mt-1 truncate text-xs text-dim">{current.channel ?? "—"}</p>
          </div>
          <LikeButton track={current} size="sm" className="-mt-1 -mr-1" />
        </div>
        {current.requester && (
          <p className="mt-3 flex items-center gap-2 text-xs text-dim">
            <Avatar src={current.requester.avatar} name={current.requester.name} className="size-5" />
            Замовив <span className="truncate font-medium text-white">{current.requester.name ?? "хтось"}</span>
          </p>
        )}
        {lib.ready && (
          <Pill variant="outline" size="sm" className="mt-4" onClick={() => openDialog({ kind: "add-to-playlist", tracks: [current] })}>
            <ListPlus className="size-3.5" /> В плейлист
          </Pill>
        )}
        {player?.last_action && <p className="mt-3 truncate text-[11px] text-faint">{player.last_action}</p>}
        {perms.hint && <p className="mt-3 rounded-lg bg-white/[0.04] px-3 py-2 text-[11px] leading-relaxed text-dim">{perms.hint}</p>}
      </div>
    </section>
  );
}

function PanelEmpty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <section className="flex flex-col items-center rounded-xl bg-side px-5 py-8 text-center">
      <div className="mb-4 grid size-16 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-green [&>svg]:size-7">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-dim">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}

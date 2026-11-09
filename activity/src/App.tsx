import { Disc3, Search, Wifi, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CompactPlayer } from "./components/CompactPlayer";
import { Logo } from "./components/Logo";
import { MiniPlayer } from "./components/MiniPlayer";
import { NowPlaying } from "./components/NowPlaying";
import { SearchBox } from "./components/SearchBox";
import { SearchPanel } from "./components/SearchPanel";
import { Fatal, GuildPicker, Splash } from "./components/Shell";
import { Toasts } from "./components/Toasts";
import { control, summon } from "./lib/actions";
import { api, ApiError, setGuild } from "./lib/api";
import { connectDiscord, DiscordStartError } from "./lib/discord";
import { activityChannelId, inDiscord, urlChannel, urlGuild } from "./lib/env";
import { useMediaQuery } from "./lib/hooks";
import { perms as computePerms } from "./lib/perms";
import { live, useLive } from "./lib/store";
import type { DevGuild, GuildState } from "./lib/types";

const DEFAULT_ACCENT = "#8b5cf6";

type Boot =
  | { kind: "loading"; step?: string }
  | { kind: "pick"; guilds: DevGuild[] }
  | { kind: "ready"; guildId: string }
  | { kind: "error"; title: string; text: string };

export function App() {
  const [boot, setBoot] = useState<Boot>(() => (urlGuild ? { kind: "ready", guildId: urlGuild } : { kind: "loading" }));

  useEffect(() => {
    if (boot.kind !== "loading") return;
    if (inDiscord) {
      let cancelled = false;
      connectDiscord((step) => !cancelled && setBoot({ kind: "loading", step }))
        .then((ctx) => !cancelled && setBoot({ kind: "ready", guildId: ctx.guildId }))
        .catch((err: unknown) => !cancelled && setBoot(discordError(err)));
      return () => {
        cancelled = true;
      };
    }
    api
      .devGuilds()
      .then(({ guilds }) => {
        if (guilds.length === 1 && guilds[0]) setBoot({ kind: "ready", guildId: guilds[0].id });
        else if (guilds.length === 0) setBoot({ kind: "error", title: "Бот не на жодному сервері", text: "Запроси бота на сервер." });
        else setBoot({ kind: "pick", guilds });
      })
      .catch((err: unknown) =>
        setBoot({
          kind: "error",
          title: "Не вдалося підключитися",
          text: `${err instanceof Error ? err.message : String(err)}. У браузері Activity працює лише з DEV_MODE=1 у .env бота; у Discord — відкрий її з голосового каналу.`,
        }),
      );
    // Лише перший запуск; step змінює boot, але не має перезапускати авторизацію.
  }, [boot.kind]);

  useEffect(() => {
    if (boot.kind !== "ready") return;
    setGuild(boot.guildId);
    live.connect(boot.guildId);
    return () => live.disconnect();
  }, [boot]);

  if (boot.kind === "loading") return <Splash text={boot.step} />;
  if (boot.kind === "error") return <Fatal title={boot.title} text={boot.text} onRetry={() => window.location.reload()} />;
  if (boot.kind === "pick") {
    return (
      <GuildPicker
        guilds={boot.guilds}
        onPick={(id) => {
          const url = new URL(window.location.href);
          url.searchParams.set("guild", id);
          window.history.replaceState(null, "", url);
          setBoot({ kind: "ready", guildId: id });
        }}
      />
    );
  }
  return <Player />;
}

function discordError(err: unknown): Boot {
  if (err instanceof DiscordStartError) return { kind: "error", title: "Не вдалося запустити", text: err.message };
  if (err instanceof ApiError && err.status === 503) {
    return { kind: "error", title: "Activity не налаштована", text: `${err.message}. Додай DISCORD_CLIENT_SECRET у .env бота.` };
  }
  if (err instanceof ApiError && err.status === 0) {
    return { kind: "error", title: "Бот недоступний", text: "Немає зв'язку з сервером бота — перевір, що бот і тунель запущені." };
  }
  return { kind: "error", title: "Не вдалося увійти", text: err instanceof Error ? err.message : String(err) };
}

function Player() {
  const { state, connection, fatal } = useLive();
  const accent = state?.player?.color ?? DEFAULT_ACCENT;

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);

  if (fatal) return <Fatal title="Немає доступу" text={fatal} onRetry={() => window.location.reload()} />;
  if (!state) return <Splash text={connection === "reconnecting" ? "Перепідключаюсь…" : undefined} />;
  return <Layout state={state} online={connection === "open"} />;
}

function Layout({ state, online }: { state: GuildState; online: boolean }) {
  const perms = computePerms(state);
  const wide = useMediaQuery("(min-width: 900px)");
  const compact = useMediaQuery("(max-height: 420px)");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"search" | "now">("search");
  useShortcuts(perms.canControl && !!state.player?.current);
  // У Discord канал Activity дає SDK; у браузері його можна задати через ?channel=<id> (для перевірки).
  useAutoSummon(state, inDiscord || urlChannel ? activityChannelId() : null);

  if (compact) {
    return (
      <div className="relative h-full overflow-hidden bg-ink">
        <Backdrop />
        <div className="relative h-full">
          <CompactPlayer state={state} perms={perms} />
        </div>
      </div>
    );
  }

  const runQuery = (q: string) => {
    setQuery(q);
    setTab("search");
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-ink">
      <Backdrop />

      <header className="relative z-30 flex items-center gap-3 px-3 py-3 sm:gap-5 sm:px-5">
        <button type="button" onClick={() => setQuery("")} aria-label="На головну">
          <Logo compact={!wide} />
        </button>
        <div className="flex min-w-0 flex-1 justify-center">
          <SearchBox onSubmit={runQuery} canAdd={perms.canAdd} />
        </div>
        <StatusPill state={state} online={online} />
      </header>

      <AnimatePresence>
        {!online && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative z-20 overflow-hidden"
          >
            <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 sm:mx-5">
              <WifiOff className="size-4 shrink-0 text-amber-300" />
              Зв'язок із ботом втрачено — перепідключаюсь… Стан на екрані може бути застарілим.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!wide && (
        <nav className="relative z-10 flex gap-1 px-3 pb-2">
          <TabButton active={tab === "search"} onClick={() => setTab("search")}>
            <Search className="size-4" /> Пошук
          </TabButton>
          <TabButton active={tab === "now"} onClick={() => setTab("now")}>
            <Disc3 className="size-4" /> Зараз грає
            {state.player && state.player.queue_total > 0 && (
              <span className="rounded-full bg-white/15 px-1.5 text-[11px] tabular-nums">{state.player.queue_total}</span>
            )}
          </TabButton>
        </nav>
      )}

      <div className="relative z-0 flex min-h-0 flex-1">
        {(wide || tab === "search") && (
          <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
            <SearchPanel query={query} onQuery={runQuery} canAdd={perms.canAdd} hint={perms.hint} />
          </main>
        )}
        {(wide || tab === "now") && (
          <aside
            className={
              wide
                ? "w-[380px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-black/25 xl:w-[420px]"
                : "min-w-0 flex-1 overflow-y-auto"
            }
          >
            <NowPlaying state={state} perms={perms} />
          </aside>
        )}
      </div>

      <MiniPlayer state={state} perms={perms} />
      <Toasts />
    </div>
  );
}

/**
 * Бот сам заходить у войс, де відкрили Activity, — якщо зараз ніде не грає, а користувач сидить у цьому
 * каналі. Один раз за запуск: якщо потім бота вигнали, кличемо його кнопкою.
 */
function useAutoSummon(state: GuildState, channelId: string | null) {
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || !channelId) return;
    if (state.voice_channel || !state.you.can_summon || state.you.voice_channel_id !== channelId) return;
    tried.current = true;
    void summon(channelId);
  }, [state, channelId]);
}

/** Пробіл — пауза/відтворення, «/» — до пошуку (коли не друкуєш у полі). */
function useShortcuts(canToggle: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      } else if (e.code === "Space" && !e.repeat && target?.tagName !== "BUTTON" && canToggle) {
        e.preventDefault();
        void control({ action: "toggle" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canToggle]);
}

/** М'яке світіння кольором обкладинки за всім інтерфейсом. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-[45vh] left-1/2 h-[90vh] w-[140vw] -translate-x-1/2 rounded-[50%] bg-[var(--accent)] opacity-[0.17] blur-[120px] transition-colors duration-1000" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink/40 to-ink" />
    </div>
  );
}

function StatusPill({ state, online }: { state: GuildState; online: boolean }) {
  const voice = state.voice_channel;
  return (
    <div
      className="hidden shrink-0 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-dim md:flex"
      title={online ? "Зв'язок із ботом є" : "Немає зв'язку з ботом — перепідключаюсь"}
    >
      {online ? <Wifi className="size-3.5 text-emerald-400" /> : <WifiOff className="size-3.5 text-amber-400" />}
      <span className="max-w-[10rem] truncate">{state.guild.name}</span>
      {voice ? (
        <span className="max-w-[10rem] truncate text-white/80">
          · 🔊 {voice.name} ({voice.listeners})
        </span>
      ) : (
        <span>· бот не у войсі</span>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
        active ? "bg-white text-black" : "bg-white/[0.06] text-dim hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

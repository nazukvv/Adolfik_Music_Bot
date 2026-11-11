import { useEffect, useState } from "react";
import { CompactPlayer } from "./components/CompactPlayer";
import { AppShell } from "./components/layout/AppShell";
import { Fatal, GuildPicker, Splash } from "./components/Shell";
import { api, ApiError, setGuild } from "./lib/api";
import { connectDiscord, DiscordStartError } from "./lib/discord";
import { inDiscord, urlGuild } from "./lib/env";
import { useMediaQuery } from "./lib/hooks";
import { library } from "./lib/library";
import { perms as computePerms } from "./lib/perms";
import { live, useLive } from "./lib/store";
import type { DevGuild } from "./lib/types";

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
    library.start(); // профіль, лайки, плейлисти — сесія вже є
    return () => {
      live.disconnect();
      library.stop();
    };
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
  const compact = useMediaQuery("(max-height: 420px)");

  if (fatal) return <Fatal title="Немає доступу" text={fatal} onRetry={() => window.location.reload()} />;
  if (!state) return <Splash text={connection === "reconnecting" ? "Перепідключаюсь…" : undefined} />;
  if (compact) {
    // Маленьке вікно Activity (картинка-в-картинці): лише плеєр.
    return (
      <div className="h-full overflow-hidden bg-ink">
        <CompactPlayer state={state} perms={computePerms(state)} />
      </div>
    );
  }
  return <AppShell state={state} online={connection === "open"} />;
}

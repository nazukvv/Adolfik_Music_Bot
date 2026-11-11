import { ChevronLeft, ChevronRight, Headphones, Wifi, WifiOff } from "lucide-react";
import { summon } from "../../lib/actions";
import { useLibrary } from "../../lib/library";
import type { Perms } from "../../lib/perms";
import { router, useRouter } from "../../lib/router";
import type { GuildState } from "../../lib/types";
import { Logo } from "../Logo";
import { Pill, RoundNav } from "../ui/Buttons";
import { Avatar } from "../ui/Bits";

/**
 * Верх центральної колонки: ← → (історія сторінок), стан бота, «Покликати бота», аватар → профіль.
 * Липка: прозора над шапкою сторінки, темніє, коли контент прокрутили.
 */
export function TopBar({
  state,
  perms,
  online,
  scrolled,
  mobile,
}: {
  state: GuildState;
  perms: Perms;
  online: boolean;
  scrolled: boolean;
  mobile: boolean;
}) {
  const { canBack, canForward } = useRouter();
  const { me } = useLibrary();
  const you = state.you;

  return (
    <header
      className={`sticky top-0 z-30 flex h-16 items-center gap-3 px-4 transition-colors duration-200 sm:px-8 ${
        scrolled ? "border-b border-line bg-main/95 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      {mobile ? (
        <button type="button" onClick={() => router.go({ name: "home" })} aria-label="На головну">
          <Logo compact />
        </button>
      ) : (
        <div className="flex gap-2">
          <RoundNav label="Назад" disabled={!canBack} onClick={() => router.back()}>
            <ChevronLeft className="size-[18px]" />
          </RoundNav>
          <RoundNav label="Вперед" disabled={!canForward} onClick={() => router.forward()}>
            <ChevronRight className="size-[18px]" />
          </RoundNav>
        </div>
      )}

      <div className="flex-1" />

      <BotStatus state={state} online={online} />
      {perms.canSummon && perms.summonChannel && (
        <Pill variant="green" size="sm" onClick={() => void summon(perms.summonChannel!)}>
          <Headphones className="size-3.5" /> Покликати бота
        </Pill>
      )}
      <button
        type="button"
        onClick={() => router.go({ name: "profile" })}
        title="Профіль і налаштування"
        aria-label="Профіль і налаштування"
        className="rounded-full ring-2 ring-transparent transition hover:ring-white/20"
      >
        <Avatar src={me?.avatar ?? you.avatar} name={me?.name ?? you.name} className="size-8" />
      </button>
    </header>
  );
}

function BotStatus({ state, online }: { state: GuildState; online: boolean }) {
  const voice = state.voice_channel;
  return (
    <div
      className="hidden min-w-0 items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-dim sm:flex"
      title={online ? "Зв'язок із ботом є" : "Немає зв'язку з ботом — перепідключаюсь"}
    >
      {online ? <Wifi className="size-3.5 shrink-0 text-green" /> : <WifiOff className="size-3.5 shrink-0 text-amber-400" />}
      <span className="max-w-[9rem] truncate">{state.guild.name}</span>
      <span className="max-w-[9rem] truncate text-white/80">{voice ? `· 🔊 ${voice.name} (${voice.listeners})` : "· бот не у войсі"}</span>
    </div>
  );
}

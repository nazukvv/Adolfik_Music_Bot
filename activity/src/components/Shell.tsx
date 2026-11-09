import { AlertTriangle, LoaderCircle, RotateCw, Server, Users } from "lucide-react";
import type { DevGuild } from "../lib/types";
import { EmptyState, PrimaryButton } from "./EmptyState";
import { Logo } from "./Logo";

/** Повноекранні стани до того, як з'явився живий стан плеєра. */
export function Splash({ text = "Підключаюсь до бота…" }: { text?: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-4 text-dim">
        <Logo />
        <span className="inline-flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> {text}
        </span>
      </div>
    </div>
  );
}

export function Fatal({ title, text, onRetry }: { title: string; text: string; onRetry?: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<AlertTriangle />}
        title={title}
        text={text}
        action={
          onRetry ? (
            <PrimaryButton onClick={onRetry}>
              <RotateCw className="size-4" /> Спробувати ще раз
            </PrimaryButton>
          ) : undefined
        }
      />
    </div>
  );
}

/** DEV_MODE у браузері: вибір сервера (у Discord guild дає SDK). */
export function GuildPicker({ guilds, onPick }: { guilds: DevGuild[]; onPick: (id: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-6 p-6">
      <div>
        <Logo />
        <h1 className="mt-6 text-2xl font-bold">Вибери сервер</h1>
        <p className="mt-1 text-sm text-dim">Режим розробки: у Discord сервер і канал визначаються автоматично.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {guilds.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => onPick(g.id)}
              className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.07]"
            >
              {g.icon ? (
                <img src={g.icon} alt="" className="size-11 rounded-xl" />
              ) : (
                <span className="grid size-11 place-items-center rounded-xl bg-white/10">
                  <Server className="size-5 text-dim" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{g.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-dim">
                  <Users className="size-3.5" /> {g.member_count ?? "?"}
                  {g.voice_channel && <span>· 🔊 {g.voice_channel}</span>}
                  {!g.you_are_member && <span className="text-amber-300/80">· тебе нема в кеші учасників</span>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { api, ApiError, type ControlAction, type PlayOptions, type PlayResult } from "./api";
import { plural } from "./format";
import { perms } from "./perms";
import { live } from "./store";
import { toast, toastError } from "./toasts";
import type { PlayMode, Track } from "./types";

// Дії користувача: запит до API → одразу застосовуємо стан із відповіді (WS теж його надішле).
//
// Бот сам у войс не заходить. Якщо його нема у войсі користувача, кнопки «грати» підписані
// «Покликати й грати» і шлють summon: true — одна кнопка кличе бота й одразу вмикає музику.

/** Чи треба кликати бота разом із цією дією (рахуємо з живого стану в момент натискання). */
function needsSummon(): boolean {
  return perms(live.getSnapshot().state).needsSummon;
}

function summonedPrefix(summoned: boolean): string {
  return summoned ? "👋 Бот іде до вас · " : "";
}

function explain(err: unknown): void {
  // Стан міг змінитися між рендером і кліком (бота забрали в інший канал) — підкажемо, що робити.
  if (err instanceof ApiError && err.code === "summon_required") {
    toast(`${err.message}: натисни «Покликати бота» вгорі`, "error", 5000);
    live.refresh();
    return;
  }
  toastError(err);
}

export async function playTrack(track: Pick<Track, "url" | "title">, mode: PlayMode): Promise<void> {
  const summon = needsSummon();
  try {
    const res = await api.play({ url: track.url }, mode, summon);
    live.apply(res.state);
    const prefix = summonedPrefix(summon);
    if (res.starting || mode === "now") toast(`${prefix}▶ Грає: ${track.title}`);
    else if (mode === "next") toast(`${prefix}⏭ Наступним: ${track.title}`);
    else toast(`${prefix}➕ У черзі #${res.position}: ${track.title}`);
  } catch (err) {
    explain(err);
  }
}

export async function playQuery(query: string, mode: PlayMode = "queue"): Promise<void> {
  const summon = needsSummon();
  try {
    const res = await api.play({ query }, mode, summon);
    live.apply(res.state);
    toast(
      summonedPrefix(summon) +
        (res.added > 1 ? `📃 Додано ${plural(res.added, "трек", "треки", "треків")}` : "➕ Додано в чергу"),
    );
  } catch (err) {
    explain(err);
  }
}

async function playList(
  run: (options: PlayOptions) => Promise<PlayResult>,
  title: string,
  options: Omit<PlayOptions, "summon">,
): Promise<void> {
  const summon = needsSummon();
  try {
    const res = await run({ mode: "queue", ...options, summon });
    live.apply(res.state);
    const count = plural(res.added, "трек", "треки", "треків");
    const verb = res.starting || options.mode === "now" ? "▶ Грає" : options.mode === "next" ? "⏭ Наступними" : "➕ У черзі";
    toast(`${summonedPrefix(summon)}${verb}: «${title}» (${count}${options.shuffle ? ", перемішано" : ""})`);
  } catch (err) {
    explain(err);
  }
}

export function playLikes(options: Omit<PlayOptions, "summon">): Promise<void> {
  return playList(api.playLikes, "Улюблені", options);
}

export function playPlaylist(id: number, name: string, options: Omit<PlayOptions, "summon">): Promise<void> {
  return playList((o) => api.playPlaylist(id, o), name, options);
}

export async function control(command: ControlAction): Promise<void> {
  try {
    const res = await api.control(command);
    live.apply(res.state);
  } catch (err) {
    toastError(err);
  }
}

export async function seek(seconds: number): Promise<void> {
  live.seekLocal(seconds);
  await control({ action: "seek", value: Math.round(seconds) });
}

export async function moveInQueue(queue: Track[], from: number, to: number): Promise<void> {
  const track = queue[from];
  if (!track || from === to) return;
  const next = [...queue];
  next.splice(to, 0, ...next.splice(from, 1));
  live.patchQueue(next);
  try {
    live.apply((await api.move(from, to, track.id)).state);
  } catch (err) {
    toastError(err);
    live.refresh();
  }
}

export async function removeFromQueue(queue: Track[], index: number): Promise<void> {
  const track = queue[index];
  if (!track) return;
  live.patchQueue(queue.filter((_, i) => i !== index));
  try {
    live.apply((await api.remove(index, track.id)).state);
  } catch (err) {
    toastError(err);
    live.refresh();
  }
}

export async function jumpTo(queue: Track[], index: number): Promise<void> {
  const track = queue[index];
  if (!track) return;
  try {
    live.apply((await api.jump(index, track.id)).state);
    toast(`⏭ Переходжу на «${track.title}»`);
  } catch (err) {
    toastError(err);
  }
}

export async function summon(channelId: string): Promise<void> {
  try {
    live.apply((await api.summon(channelId)).state);
    toast("👋 Бот уже йде до вас у канал");
  } catch (err) {
    toastError(err);
  }
}

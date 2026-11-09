import { api, type ControlAction } from "./api";
import { plural } from "./format";
import { live } from "./store";
import { toast, toastError } from "./toasts";
import type { PlayMode, Track } from "./types";

// Дії користувача: запит до API → одразу застосовуємо стан із відповіді (WS теж його надішле).

export async function playTrack(track: Pick<Track, "url" | "title">, mode: PlayMode): Promise<void> {
  try {
    const res = await api.play({ url: track.url }, mode);
    live.apply(res.state);
    if (res.starting || mode === "now") toast(`▶ Грає: ${track.title}`);
    else if (mode === "next") toast(`⏭ Наступним: ${track.title}`);
    else toast(`➕ У черзі #${res.position}: ${track.title}`);
  } catch (err) {
    toastError(err);
  }
}

export async function playQuery(query: string, mode: PlayMode = "queue"): Promise<void> {
  try {
    const res = await api.play({ query }, mode);
    live.apply(res.state);
    toast(res.added > 1 ? `📃 Додано ${plural(res.added, "трек", "треки", "треків")}` : "➕ Додано в чергу");
  } catch (err) {
    toastError(err);
  }
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

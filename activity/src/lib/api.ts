import { devUser } from "./env";
import type {
  DevGuild,
  GuildState,
  HistoryTrack,
  LoopMode,
  Me,
  PlayMode,
  PlaylistDetail,
  PlaylistSummary,
  Track,
} from "./types";

// Відносні шляхи: у браузері їх обслуговує бекенд (або проксі Vite), у Discord — проксі
// {client_id}.discordsays.com за URL mapping «/» (як в офіційному прикладі Discord: fetch("/api/token")).

let session: string | null = null;
let guildId = "";

export function setSession(token: string | null): void {
  session = token;
}

export function getSession(): string | null {
  return session;
}

export function setGuild(id: string): void {
  guildId = id;
}

export function getGuild(): string {
  return guildId;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Машинний код: not_in_voice, summon_required — щоб інтерфейс знав, що запропонувати. */
    public code: string | null = null,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (session) h.Authorization = `Bearer ${session}`;
  else if (devUser) h["X-Dev-User"] = devUser;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function request<T>(method: Method, path: string, body?: object, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: headers(body !== undefined),
      body: body !== undefined ? JSON.stringify({ guild: guildId, ...body }) : undefined,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "Немає зв'язку з сервером бота");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Помилка ${res.status}`, data.code ?? null);
  return data as T;
}

const withGuild = (path: string, extra: Record<string, string> = {}) =>
  `${path}?${new URLSearchParams({ guild: guildId, ...extra })}`;

export interface MutationResult {
  ok: true;
  state: GuildState;
}

export interface PlayResult extends MutationResult {
  added: number;
  position: number;
  starting: boolean;
}

/** Як грати список: у чергу / наступним / зараз; summon — покликати бота, якщо його нема у твоєму войсі. */
export interface PlayOptions {
  mode?: PlayMode;
  shuffle?: boolean;
  summon?: boolean;
}

export type ControlAction =
  | { action: "pause" | "resume" | "toggle" | "skip" | "stop" | "previous_restart" | "shuffle" }
  | { action: "seek"; value: number }
  | { action: "volume"; value: number }
  | { action: "loop"; value?: LoopMode };

export interface TokenResult {
  access_token: string;
  session: string;
  user: { id: string; name: string; avatar: string | null };
}

export const api = {
  config: () => request<{ client_id: string | null; dev_mode: boolean }>("GET", "/api/config"),
  token: (code: string) => request<TokenResult>("POST", "/api/token", { code }),
  devGuilds: () => request<{ guilds: DevGuild[] }>("GET", "/api/dev/guilds"),
  state: () => request<GuildState>("GET", withGuild("/api/state")),
  search: (q: string, signal?: AbortSignal) =>
    request<{ query: string; results: Track[] }>("GET", `/api/search?${new URLSearchParams({ q })}`, undefined, signal),
  play: (target: { query?: string; url?: string }, mode: PlayMode = "queue", summon = false) =>
    request<PlayResult>("POST", "/api/play", { ...target, mode, summon }),
  control: (command: ControlAction) => request<MutationResult>("POST", "/api/control", command),
  move: (from: number, to: number, id: string) => request<MutationResult>("POST", "/api/queue/move", { from, to, id }),
  remove: (index: number, id: string) => request<MutationResult>("POST", "/api/queue/remove", { index, id }),
  jump: (index: number, id: string) => request<MutationResult>("POST", "/api/queue/jump", { index, id }),
  summon: (channelId: string) => request<MutationResult>("POST", "/api/summon", { channel_id: channelId }),

  // ---------- бібліотека ----------
  me: () => request<Me>("GET", "/api/me"),
  history: (signal?: AbortSignal) => request<{ tracks: HistoryTrack[] }>("GET", withGuild("/api/history"), undefined, signal),
  recent: (signal?: AbortSignal) => request<{ tracks: HistoryTrack[] }>("GET", "/api/me/recent", undefined, signal),
  likes: (signal?: AbortSignal) => request<{ tracks: Track[]; total: number }>("GET", "/api/me/likes", undefined, signal),
  likeIds: () => request<{ ids: string[] }>("GET", "/api/me/likes/ids"),
  like: (videoId: string) => request<{ liked: true; added: boolean }>("PUT", `/api/me/likes/${encodeURIComponent(videoId)}`),
  unlike: (videoId: string) =>
    request<{ liked: false; removed: boolean }>("DELETE", `/api/me/likes/${encodeURIComponent(videoId)}`),
  playLikes: (options: PlayOptions) => request<PlayResult>("POST", "/api/me/likes/play", options),
  playlists: () => request<{ playlists: PlaylistSummary[]; limit: number }>("GET", "/api/me/playlists"),
  playlist: (id: number, signal?: AbortSignal) =>
    request<PlaylistDetail>("GET", `/api/me/playlists/${id}`, undefined, signal),
  playPlaylist: (id: number, options: PlayOptions) =>
    request<PlayResult>("POST", `/api/me/playlists/${id}/play`, options),
};

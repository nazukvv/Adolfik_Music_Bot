import { devUser } from "./env";
import type { DevGuild, GuildState, LoopMode, PlayMode, Track } from "./types";

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
  ) {
    super(message);
  }
}

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (session) h.Authorization = `Bearer ${session}`;
  else if (devUser) h["X-Dev-User"] = devUser;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function request<T>(method: "GET" | "POST", path: string, body?: object, signal?: AbortSignal): Promise<T> {
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
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Помилка ${res.status}`);
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
  play: (target: { query?: string; url?: string }, mode: PlayMode = "queue") =>
    request<PlayResult>("POST", "/api/play", { ...target, mode }),
  control: (command: ControlAction) => request<MutationResult>("POST", "/api/control", command),
  move: (from: number, to: number, id: string) => request<MutationResult>("POST", "/api/queue/move", { from, to, id }),
  remove: (index: number, id: string) => request<MutationResult>("POST", "/api/queue/remove", { index, id }),
  jump: (index: number, id: string) => request<MutationResult>("POST", "/api/queue/jump", { index, id }),
  summon: (channelId: string) => request<MutationResult>("POST", "/api/summon", { channel_id: channelId }),
};

import { useEffect, useState, useSyncExternalStore } from "react";
import { getSession } from "./api";
import { devUser } from "./env";
import type { GuildState, PositionMessage, ServerMessage, Track } from "./types";

export type Connection = "idle" | "connecting" | "open" | "reconnecting" | "failed";

interface Snapshot {
  state: GuildState | null;
  connection: Connection;
  fatal: string | null;
}

interface PositionBase {
  pos: number;
  at: number;
  running: boolean;
  duration: number | null;
  trackId: string | null;
}

const FATAL = new Set([400, 401, 403, 404]);

/**
 * Живий стан плеєра з WebSocket /api/ws.
 * Сервер шле повний стан при підключенні й після кожної зміни, а позицію — раз на 1.5 с;
 * між ними позиція інтерполюється локально (position()).
 */
class LiveStore {
  private snap: Snapshot = { state: null, connection: "idle", fatal: null };
  private listeners = new Set<() => void>();
  private base: PositionBase = { pos: 0, at: 0, running: false, duration: null, trackId: null };
  private ws: WebSocket | null = null;
  private guildId = "";
  private retry = 0;
  private timer: number | undefined;
  private stopped = true;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snap;

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of this.listeners) listener();
  }

  connect(guildId: string): void {
    this.disconnect();
    this.guildId = guildId;
    this.stopped = false;
    this.retry = 0;
    this.set({ fatal: null });
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  /** Попросити повний стан (наприклад, після невдалої оптимістичної зміни). */
  /** Зупинитись із фатальною помилкою (наприклад, сесія протухла посеред роботи). */
  fail(message: string): void {
    this.disconnect();
    this.set({ connection: "failed", fatal: message });
  }

  refresh(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "state" }));
  }

  private open(): void {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ guild: this.guildId });
    if (!getSession() && devUser) params.set("user", devUser);
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws?${params}`);
    this.ws = ws;
    this.set({ connection: this.retry ? "reconnecting" : "connecting" });

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", session: getSession() ?? undefined, user: devUser ?? undefined }));
    };
    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "state") {
        this.retry = 0;
        this.apply(msg);
        if (this.snap.connection !== "open") this.set({ connection: "open" });
      } else if (msg.type === "position") {
        this.onPosition(msg);
      } else if (msg.type === "error" && FATAL.has(msg.status)) {
        this.stopped = true;
        this.set({ connection: "failed", fatal: msg.error });
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.set({ connection: "reconnecting" });
      const delay = Math.min(10_000, 800 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => this.open(), delay);
    };
  }

  /** Повний стан із WS або з відповіді на POST. */
  apply(state: GuildState): void {
    const player = state.player;
    const current = player?.current ?? null;
    this.base = {
      pos: player?.position ?? 0,
      at: performance.now(),
      running: !!current && !player!.paused && !player!.preparing,
      duration: current?.is_live ? null : (current?.duration ?? null),
      trackId: current?.id ?? null,
    };
    this.set({ state });
  }

  private onPosition(msg: PositionMessage): void {
    if (msg.track_id !== this.base.trackId) return;
    this.base = { ...this.base, pos: msg.position, at: performance.now(), running: !msg.paused };
  }

  /** Оптимістична зміна черги (drag-and-drop): одразу показуємо, сервер підтвердить станом. */
  patchQueue(queue: Track[]): void {
    const state = this.snap.state;
    if (!state?.player) return;
    this.set({ state: { ...state, player: { ...state.player, queue } } });
  }

  /** Поточна позиція з урахуванням часу, що минув від останнього оновлення. */
  position(): number {
    const b = this.base;
    if (!b.running) return b.pos;
    const pos = b.pos + (performance.now() - b.at) / 1000;
    return b.duration ? Math.min(pos, b.duration) : pos;
  }

  /** Локально «перемотати» (поки сервер перезапускає ffmpeg з -ss). */
  seekLocal(seconds: number): void {
    this.base = { ...this.base, pos: seconds, at: performance.now() };
  }
}

export const live = new LiveStore();

export function useLive(): Snapshot {
  return useSyncExternalStore(live.subscribe, live.getSnapshot);
}

/** Позиція треку, що оновлюється fps разів на секунду (рендериться лише компонент, який її читає). */
export function usePosition(fps = 4): number {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000 / fps);
    return () => window.clearInterval(id);
  }, [fps]);
  return live.position();
}

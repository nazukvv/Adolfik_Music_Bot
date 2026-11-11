import { useSyncExternalStore } from "react";
import { api } from "./api";
import { plural } from "./format";
import { live } from "./store";
import { toast, toastError } from "./toasts";
import type { LibraryEvent, Me, PlaylistSummary, Track } from "./types";

// Бібліотека поточного користувача: профіль, які треки лайкнуті, список плейлистів.
// Вантажиться один раз після входу; далі оновлюється з WS-подій library (зокрема з ❤ на панелі в Discord).

interface Snapshot {
  me: Me | null;
  /** false — ще вантажимо або бібліотека на сервері вимкнена. */
  ready: boolean;
  liked: ReadonlySet<string>;
  playlists: PlaylistSummary[];
  /** Росте на кожну зміну — сторінки (Улюблені, плейлист) перезавантажують свої дані. */
  version: number;
}

class LibraryStore {
  private snap: Snapshot = { me: null, ready: false, liked: new Set(), playlists: [], version: 0 };
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snap;

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of this.listeners) listener();
  }

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = live.onLibrary((event) => void this.onEvent(event));
    void this.load();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async load(): Promise<void> {
    try {
      const me = await api.me();
      if (!me.library) {
        this.set({ me, ready: false });
        return;
      }
      const [{ ids }, { playlists }] = await Promise.all([api.likeIds(), api.playlists()]);
      this.set({ me, ready: true, liked: new Set(ids), playlists, version: this.snap.version + 1 });
    } catch (err) {
      toastError(err);
    }
  }

  private async onEvent(event: LibraryEvent): Promise<void> {
    if (event.what === "likes") {
      const liked = new Set(this.snap.liked);
      if (event.liked) liked.add(event.video_id);
      else liked.delete(event.video_id);
      this.set({ liked, version: this.snap.version + 1 });
      void this.refreshMe();
    } else if (event.what === "playlists") {
      await this.refreshPlaylists();
    } else {
      await this.load();
    }
  }

  private async refreshMe(): Promise<void> {
    try {
      this.set({ me: await api.me() });
    } catch {
      // статистика профілю не критична
    }
  }

  async refreshPlaylists(): Promise<void> {
    try {
      const { playlists } = await api.playlists();
      this.set({ playlists, version: this.snap.version + 1 });
      void this.refreshMe();
    } catch (err) {
      toastError(err);
    }
  }

  // ---------- плейлисти ----------
  // Методи для діалогів кидають помилку (діалог покаже її під полем); решта — тостом.
  // Після запису одразу перечитуємо список; WS-подія library прийде ще й іншим вкладкам.

  async createPlaylist(name: string, tracks: Track[] = []): Promise<PlaylistSummary> {
    const { playlist } = await api.createPlaylist(name, tracks.map((t) => t.id));
    await this.refreshPlaylists();
    toast(tracks.length ? `➕ Створено «${playlist.name}» і додано трек` : `📃 Створено плейлист «${playlist.name}»`);
    return playlist;
  }

  async importPlaylist(url: string, name?: string): Promise<PlaylistSummary> {
    const { playlist, imported } = await api.importPlaylist(url, name);
    await this.refreshPlaylists();
    toast(`📥 Імпортовано «${playlist.name}»: ${plural(imported, "трек", "треки", "треків")}`);
    return playlist;
  }

  async renamePlaylist(id: number, name: string): Promise<void> {
    await api.renamePlaylist(id, name);
    await this.refreshPlaylists();
  }

  async deletePlaylist(id: number, name: string): Promise<void> {
    await api.deletePlaylist(id);
    await this.refreshPlaylists();
    toast(`🗑 Плейлист «${name}» видалено`);
  }

  async addToPlaylist(id: number, name: string, tracks: Track[]): Promise<void> {
    const { added, skipped } = await api.addToPlaylist(id, tracks.map((t) => t.id));
    await this.refreshPlaylists();
    if (added === 0) toast(`Плейлист «${name}» заповнений — більше треків не влізе`, "error", 5000);
    else if (tracks.length === 1) toast(`➕ Додано в «${name}»`);
    else toast(`➕ У «${name}» додано ${plural(added, "трек", "треки", "треків")}${skipped ? ` (${skipped} не влізли)` : ""}`);
  }

  async removeFromPlaylist(id: number, entryId: number, title: string): Promise<void> {
    try {
      await api.removeFromPlaylist(id, entryId);
      await this.refreshPlaylists();
      toast(`Прибрано з плейлиста: ${title}`);
    } catch (err) {
      toastError(err);
    }
  }

  /** Перетягування в плейлисті: сторінка вже показала новий порядок, тут — лише сервер. */
  async reorder(id: number, entryId: number, to: number): Promise<boolean> {
    try {
      await api.reorderPlaylist(id, entryId, to);
      return true;
    } catch (err) {
      toastError(err);
      await this.refreshPlaylists(); // сторінка перечитає справжній порядок
      return false;
    }
  }

  /** Видалити свої дані: профіль, лайки, плейлисти (в історії серверів ім'я прибирається). */
  async deleteMyData(): Promise<void> {
    const { deleted } = await api.deleteMe();
    await this.load();
    toast(
      `Дані видалено: ${plural(deleted.likes, "лайк", "лайки", "лайків")}, ${plural(deleted.playlists, "плейлист", "плейлисти", "плейлистів")}`,
      "info",
      6000,
    );
  }

  isLiked(videoId: string): boolean {
    return this.snap.liked.has(videoId);
  }

  /** ❤: одразу малюємо, сервер підтверджує; WS-подія прийде й іншим вкладкам цього користувача. */
  async toggleLike(track: Pick<Track, "id" | "title">): Promise<void> {
    const wasLiked = this.snap.liked.has(track.id);
    const optimistic = new Set(this.snap.liked);
    if (wasLiked) optimistic.delete(track.id);
    else optimistic.add(track.id);
    this.set({ liked: optimistic });
    try {
      if (wasLiked) await api.unlike(track.id);
      else {
        await api.like(track.id);
        toast(`❤ В улюблених: ${track.title}`);
      }
    } catch (err) {
      const reverted = new Set(this.snap.liked);
      if (wasLiked) reverted.add(track.id);
      else reverted.delete(track.id);
      this.set({ liked: reverted });
      toastError(err);
    }
  }
}

export const library = new LibraryStore();

export function useLibrary(): Snapshot {
  return useSyncExternalStore(library.subscribe, library.getSnapshot);
}

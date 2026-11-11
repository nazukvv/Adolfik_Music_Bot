import { useSyncExternalStore } from "react";

// Маленький роутер у пам'яті з історією для кнопок ← →.
// Адресу вікна не чіпаємо: Activity живе в iframe Discord, а SDK читає параметри з URL при старті.

export type Route =
  | { name: "home" }
  | { name: "search"; q?: string }
  | { name: "likes" }
  | { name: "library" }
  | { name: "playlist"; id: number }
  | { name: "profile" };

interface Snapshot {
  route: Route;
  /** Позиція в історії: за нею центральна колонка відновлює прокрутку на «назад». */
  index: number;
  canBack: boolean;
  canForward: boolean;
}

const MAX_HISTORY = 50;

/** ?page=search|likes|library|profile|playlist-<id> — стартова сторінка (браузер/DEV, скріншоти). */
function initialRoute(): Route {
  const page = new URLSearchParams(window.location.search).get("page") ?? "";
  if (page === "search" || page === "likes" || page === "library" || page === "profile") return { name: page };
  const playlist = /^playlist-(\d+)$/.exec(page);
  if (playlist?.[1]) return { name: "playlist", id: Number(playlist[1]) };
  return { name: "home" };
}

class Router {
  private stack: Route[] = [initialRoute()];
  private index = 0;
  private snap: Snapshot = { route: this.stack[0]!, index: 0, canBack: false, canForward: false };
  private listeners = new Set<() => void>();
  /** Куди скролити центральну колонку після переходу (зберігаємо позицію для «назад»). */
  scrollTops = new Map<number, number>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snap;

  private emit(): void {
    this.snap = {
      route: this.stack[this.index] ?? { name: "home" },
      index: this.index,
      canBack: this.index > 0,
      canForward: this.index < this.stack.length - 1,
    };
    for (const listener of this.listeners) listener();
  }

  go(route: Route): void {
    if (sameRoute(route, this.snap.route)) return;
    this.stack = [...this.stack.slice(0, this.index + 1), route].slice(-MAX_HISTORY);
    this.index = this.stack.length - 1;
    this.scrollTops.delete(this.index);
    this.emit();
  }

  /** Замінити поточний запис (наприклад, новий пошуковий запит не плодить історію на кожну літеру). */
  replace(route: Route): void {
    this.stack[this.index] = route;
    this.emit();
  }

  back(): void {
    if (this.index > 0) {
      this.index--;
      this.emit();
    }
  }

  forward(): void {
    if (this.index < this.stack.length - 1) {
      this.index++;
      this.emit();
    }
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const router = new Router();

export function useRouter(): Snapshot {
  return useSyncExternalStore(router.subscribe, router.getSnapshot);
}

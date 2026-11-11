import { useSyncExternalStore } from "react";
import type { Track } from "./types";

// Один діалог на весь застосунок: будь-яка кнопка (меню «⋯», сайдбар, сторінка) відкриває потрібний,
// а AppShell малює його поверх усього.

export type Dialog =
  | { kind: "add-to-playlist"; tracks: Track[] }
  /** open — після створення перейти на сторінку нового плейлиста. */
  | { kind: "create-playlist"; tracks?: Track[]; open?: boolean }
  | { kind: "rename-playlist"; id: number; name: string }
  | { kind: "delete-playlist"; id: number; name: string; count: number }
  | { kind: "import-playlist" }
  | { kind: "delete-data" };

let current: Dialog | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openDialog(dialog: Dialog): void {
  current = dialog;
  emit();
}

export function closeDialog(): void {
  current = null;
  emit();
}

export function useDialog(): Dialog | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

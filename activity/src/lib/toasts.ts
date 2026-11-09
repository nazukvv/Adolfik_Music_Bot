import { useSyncExternalStore } from "react";
import { ApiError } from "./api";
import { live } from "./store";

export interface Toast {
  id: number;
  kind: "info" | "error";
  text: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function toast(text: string, kind: Toast["kind"] = "info", ttl = 3500): void {
  const item = { id: nextId++, kind, text };
  toasts = [...toasts.slice(-3), item];
  emit();
  window.setTimeout(() => dismiss(item.id), ttl);
}

export function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Показати помилку API (або будь-яку іншу) тостом. */
export function toastError(err: unknown): void {
  if (err instanceof DOMException && err.name === "AbortError") return;
  if (err instanceof ApiError && err.status === 401) {
    // Сесія протухла (або бот перезапустився без SESSION_SECRET) — замість лавини тостів просимо увійти знову.
    live.fail(err.message);
    return;
  }
  const text = err instanceof ApiError || err instanceof Error ? err.message : "Щось пішло не так";
  toast(text, "error", 5000);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );
}

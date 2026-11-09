import { LoaderCircle, Link2, Play, Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { playQuery, playTrack } from "../lib/actions";
import { api } from "../lib/api";
import { fmtTime, looksLikeUrl } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import type { Track } from "../lib/types";
import { Cover } from "./Cover";

const SUGGESTIONS = 6;

interface Props {
  onSubmit: (query: string) => void;
  canAdd: boolean;
}

export function SearchBox({ onSubmit, canAdd }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const query = useDebounced(text.trim(), 300);
  const isUrl = looksLikeUrl(text);

  useEffect(() => {
    if (isUrl || query.length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    api
      .search(query, ctrl.signal)
      .then((res) => {
        setItems(res.results.slice(0, SUGGESTIONS));
        setActive(-1);
      })
      .catch(() => setItems([]))
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, isUrl]);

  // Закрити підказки кліком повз поле
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const submit = () => {
    const q = text.trim();
    if (!q) return;
    setOpen(false);
    if (isUrl) {
      void playQuery(q, "queue");
      setText("");
    } else {
      onSubmit(q);
    }
    input.current?.blur();
  };

  const pick = (track: Track, mode: "queue" | "now") => {
    setOpen(false);
    void playTrack(track, mode);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = active >= 0 ? items[active] : undefined;
      if (chosen && canAdd) pick(chosen, "queue");
      else submit();
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  const showDropdown = open && text.trim().length >= 2 && (isUrl || items.length > 0);

  return (
    <div ref={wrap} className="relative w-full max-w-2xl">
      <div
        className={`flex h-12 items-center gap-3 rounded-full border px-4 transition-colors duration-200 ${
          open ? "border-white/15 bg-raise" : "border-white/[0.06] bg-white/[0.06] hover:bg-white/10"
        }`}
      >
        <Search className="size-5 shrink-0 text-dim" />
        <input
          ref={input}
          id="search-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Пошук на YouTube або посилання"
          aria-label="Пошук"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        {loading && <LoaderCircle className="size-4 shrink-0 animate-spin text-dim" />}
        {!text && !open && (
          <kbd className="hidden shrink-0 rounded-md border border-white/15 px-1.5 text-[11px] text-faint hoverable:inline" title="Натисни /, щоб шукати">
            /
          </kbd>
        )}
        {text && (
          <button
            type="button"
            onClick={() => {
              setText("");
              setItems([]);
              input.current?.focus();
            }}
            className="grid size-7 shrink-0 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-white"
            aria-label="Очистити"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-14 z-40 overflow-hidden rounded-2xl border border-white/10 bg-raise/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            {isUrl ? (
              <button
                type="button"
                onClick={submit}
                disabled={!canAdd}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/10 disabled:opacity-50"
              >
                <Link2 className="size-5 text-[var(--accent)]" />
                <span className="min-w-0 flex-1 truncate text-sm">Увімкнути посилання</span>
                <span className="text-xs text-faint">Enter</span>
              </button>
            ) : (
              <>
                {items.map((track, i) => (
                  <div
                    key={track.key}
                    onPointerEnter={() => setActive(i)}
                    className={`group flex items-center gap-3 rounded-xl px-2 py-1.5 ${active === i ? "bg-white/10" : ""}`}
                  >
                    <button
                      type="button"
                      disabled={!canAdd}
                      onClick={() => pick(track, "queue")}
                      title={canAdd ? "Додати в чергу" : "Зайди в голосовий канал"}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
                    >
                      <Cover src={track.thumbnail_small} className="h-10 w-[72px] shrink-0" rounded="rounded-md" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{track.title}</span>
                        <span className="block truncate text-xs text-dim">
                          {track.channel ?? "—"} · {track.is_live ? "наживо" : fmtTime(track.duration)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!canAdd}
                      onClick={() => pick(track, "now")}
                      title="Грати зараз"
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-black opacity-0 transition group-hover:opacity-100 disabled:hidden touch:opacity-100"
                    >
                      <Play className="size-4 fill-current" />
                    </button>
                    <button
                      type="button"
                      disabled={!canAdd}
                      onClick={() => pick(track, "queue")}
                      title="Додати в чергу"
                      className="grid size-8 shrink-0 place-items-center rounded-full text-dim transition hover:bg-white/10 hover:text-white disabled:hidden"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={submit}
                  className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-dim hover:bg-white/10 hover:text-white"
                >
                  <Search className="size-4" />
                  Усі результати для «{text.trim()}»
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

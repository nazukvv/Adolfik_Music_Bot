import { Headphones, Link2, ListPlus, LoaderCircle, Play, Search, SearchX, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { playQuery } from "../../lib/actions";
import { api } from "../../lib/api";
import { looksLikeUrl } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import { type Perms, playLabel } from "../../lib/perms";
import { router } from "../../lib/router";
import { toastError } from "../../lib/toasts";
import type { GuildState, Track } from "../../lib/types";
import { Pill } from "../ui/Buttons";
import { Hero } from "../ui/Hero";
import { TableEmpty, TrackTable } from "../ui/TrackTable";

const IDEAS = ["lofi hip hop", "synthwave", "phonk", "українська музика", "rock classics", "jazz для роботи"];

/** Пошук: поле в шапці, живі результати таблицею; посилання YouTube вмикається одразу. */
export function SearchPage({ state, perms, initial }: { state: GuildState; perms: Perms; initial: string }) {
  const [text, setText] = useState(initial);
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const query = useDebounced(text.trim(), 350);
  const isUrl = looksLikeUrl(text);

  // На телефоні клавіатура сама не вискакує — лише на десктопі.
  useEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) input.current?.focus();
  }, []);

  useEffect(() => {
    if (isUrl) return;
    router.replace({ name: "search", q: query || undefined });
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    api
      .search(query, ctrl.signal)
      .then((res) => setResults(res.results))
      .catch((err: unknown) => {
        toastError(err);
        setResults([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, isUrl]);

  const playUrl = (mode: "now" | "queue") => {
    void playQuery(text.trim(), mode);
    setText("");
  };

  return (
    <>
      <Hero label="Пошук на YouTube" labelIcon={<Search />} title="Що послухаємо?" subtitle="Знайди трек або встав посилання YouTube — він заграє для всіх у голосовому каналі.">
        <div className="relative mt-6 max-w-2xl">
          <div className="flex h-12 items-center gap-3 rounded-full bg-hover px-5 ring-1 ring-white/[0.06] transition focus-within:ring-white/25">
            {loading ? <LoaderCircle className="size-5 shrink-0 animate-spin text-dim" /> : <Search className="size-5 shrink-0 text-dim" />}
            <input
              ref={input}
              id="search-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isUrl && perms.canAdd) playUrl("now");
                if (e.key === "Escape") setText("");
              }}
              placeholder="Назва треку, виконавець або посилання"
              aria-label="Пошук"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            />
            {text && (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  input.current?.focus();
                }}
                aria-label="Очистити"
                className="grid size-7 shrink-0 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        {!text && (
          <div className="mt-5 flex flex-wrap gap-2">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setText(idea)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-[13px] font-medium transition hover:bg-white/[0.12]"
              >
                <Sparkles className="size-3.5 text-green" />
                {idea}
              </button>
            ))}
          </div>
        )}
        {perms.hint && <p className="mt-4 text-xs text-faint">{perms.hint}</p>}
      </Hero>

      <div className="pb-8">
        {isUrl ? (
          <div className="mx-4 flex flex-col gap-4 rounded-xl bg-side p-5 sm:mx-8 sm:flex-row sm:items-center">
            <Link2 className="size-6 shrink-0 text-green" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Посилання YouTube</p>
              <p className="truncate text-xs text-dim">{text.trim()}</p>
            </div>
            <div className="flex gap-2">
              <Pill variant="green" size="sm" disabled={!perms.canAdd} onClick={() => playUrl("now")}>
                {perms.needsSummon ? <Headphones className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
                {playLabel(perms, "Увімкнути")}
              </Pill>
              <Pill variant="gray" size="sm" disabled={!perms.canAdd} onClick={() => playUrl("queue")}>
                <ListPlus className="size-3.5" /> У чергу
              </Pill>
            </div>
          </div>
        ) : query.length >= 2 ? (
          <>
            <div className="mb-1 px-4 text-sm text-dim sm:px-8">
              Результати для <span className="font-semibold text-white">«{query}»</span>
            </div>
            <TrackTable
              tracks={results}
              state={state}
              perms={perms}
              loading={loading}
              empty={!loading && <TableEmpty icon={<SearchX />} title="Нічого не знайшов" text="Спробуй інакше сформулювати запит." />}
            />
          </>
        ) : null}
      </div>
    </>
  );
}

import { ListPlus, Play, Search as SearchIcon, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { playTrack } from "../lib/actions";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { toastError } from "../lib/toasts";
import type { Track } from "../lib/types";
import { Cover } from "./Cover";
import { EmptyState } from "./EmptyState";

const IDEAS = ["lofi hip hop", "synthwave", "phonk", "українська музика", "rock classics", "jazz для роботи"];

interface Props {
  query: string;
  onQuery: (query: string) => void;
  canAdd: boolean;
  hint: string | null;
}

export function SearchPanel({ query, onQuery, canAdd, hint }: Props) {
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) return;
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
  }, [query]);

  if (!query) {
    return (
      <div className="mx-auto max-w-3xl pt-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Що послухаємо?</h1>
        <p className="mt-2 text-dim">
          Знайди трек або встав посилання YouTube — він заграє для всіх у голосовому каналі.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => onQuery(idea)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm transition hover:border-white/20 hover:bg-white/10"
            >
              <Sparkles className="size-3.5 text-[var(--accent)]" />
              {idea}
            </button>
          ))}
        </div>
        {hint && <p className="mt-6 text-sm text-faint">{hint}</p>}
      </div>
    );
  }

  return (
    <section className="pt-2">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="truncate text-xl font-bold">
          <span className="text-dim">Результати:</span> {query}
        </h2>
        {hint && <span className="hidden shrink-0 text-xs text-faint md:block">{hint}</span>}
      </div>
      {loading && results.length === 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-6">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-video rounded-xl bg-white/[0.06]" />
              <div className="mt-2 h-4 w-4/5 rounded bg-white/[0.06]" />
              <div className="mt-1.5 h-3 w-1/2 rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <EmptyState icon={<SearchIcon />} title="Нічого не знайшов" text="Спробуй інакше сформулювати запит." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-6">
          {results.map((track, i) => (
            <TrackCard key={track.key} track={track} index={i} canAdd={canAdd} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrackCard({ track, index, canAdd }: { track: Track; index: number; canAdd: boolean }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.025, ease: [0.22, 1, 0.36, 1] }}
      className="group"
    >
      <div className="relative aspect-video overflow-hidden rounded-xl">
        <Cover
          src={track.thumbnail_small}
          alt={track.title}
          className="size-full transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          rounded=""
        />
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
          {track.is_live ? "🔴 НАЖИВО" : fmtTime(track.duration)}
        </span>
        {/* На ховері — дві дії; на телефоні їх видно під назвою */}
        <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/55 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100 hoverable:flex">
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => void playTrack(track, "now")}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-black transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="size-4 fill-current" /> Грати зараз
          </button>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => void playTrack(track, "queue")}
            title="Додати в чергу"
            className="grid size-9 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ListPlus className="size-4" />
          </button>
        </div>
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm leading-snug font-semibold" title={track.title}>
        {track.title}
      </h3>
      <p className="mt-0.5 truncate text-xs text-dim">{track.channel ?? "—"}</p>
      <div className="mt-2 hidden gap-2 touch:flex">
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => void playTrack(track, "now")}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-[var(--accent)] py-1.5 text-xs font-semibold text-black disabled:opacity-50"
        >
          <Play className="size-3.5 fill-current" /> Грати
        </button>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => void playTrack(track, "queue")}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-white/10 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          <ListPlus className="size-3.5" /> У чергу
        </button>
      </div>
    </motion.article>
  );
}

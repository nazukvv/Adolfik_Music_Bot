import { Download, ListMusic, LoaderCircle, Plus, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../lib/api";
import { closeDialog, type Dialog, useDialog } from "../lib/dialogs";
import { plural } from "../lib/format";
import { library, useLibrary } from "../lib/library";
import { router } from "../lib/router";
import type { Track } from "../lib/types";
import { Cover } from "./Cover";
import { Pill } from "./ui/Buttons";
import { PlaylistCover } from "./ui/Bits";

const NAME_MAX = 100;

/** Поточний діалог поверх усього (див. lib/dialogs.ts). */
export function Dialogs() {
  const dialog = useDialog();
  return createPortal(
    <AnimatePresence>{dialog && <DialogFrame key={dialog.kind} dialog={dialog} />}</AnimatePresence>,
    document.body,
  );
}

function DialogFrame({ dialog }: { dialog: Dialog }) {
  const [busy, setBusy] = useState(false);
  const close = () => !busy && closeDialog();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        role="dialog"
        aria-modal
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-raise shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
      >
        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label="Закрити"
          className="absolute top-4 right-4 z-10 grid size-8 place-items-center rounded-full text-dim transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <X className="size-4" />
        </button>
        <DialogBody dialog={dialog} busy={busy} setBusy={setBusy} />
      </motion.div>
    </motion.div>
  );
}

interface BodyProps {
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

function DialogBody({ dialog, ...props }: BodyProps & { dialog: Dialog }) {
  switch (dialog.kind) {
    case "add-to-playlist":
      return <AddToPlaylist tracks={dialog.tracks} {...props} />;
    case "create-playlist":
      return <CreatePlaylist tracks={dialog.tracks ?? []} open={!!dialog.open} {...props} />;
    case "rename-playlist":
      return <RenamePlaylist id={dialog.id} name={dialog.name} {...props} />;
    case "delete-playlist":
      return <DeletePlaylist id={dialog.id} name={dialog.name} count={dialog.count} {...props} />;
    case "import-playlist":
      return <ImportPlaylist {...props} />;
    case "delete-data":
      return <DeleteData {...props} />;
  }
}

// ---------- загальні шматки ----------

function Head({ title, text }: { title: string; text?: ReactNode }) {
  return (
    <div className="px-6 pt-6 pr-14">
      <h2 className="text-lg font-bold">{title}</h2>
      {text && <div className="mt-1 text-sm text-dim">{text}</div>}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 px-6 pt-2 pb-6">{children}</div>;
}

function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-[#ff6b5e]" role="alert">
      <TriangleAlert className="mt-px size-3.5 shrink-0" /> {children}
    </p>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  autoFocus,
  selectOnFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    input.current?.focus();
    if (selectOnFocus) input.current?.select();
  }, [autoFocus, selectOnFocus]);
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-dim">{label}</span>
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        spellCheck={false}
        className="h-11 w-full rounded-xl bg-[#0f0f0f] px-4 text-sm ring-1 ring-white/[0.08] transition outline-none placeholder:text-faint focus:ring-white/30"
      />
    </label>
  );
}

function message(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Щось пішло не так";
}

/** Обгортка дії діалогу: busy, помилка під полем, закриття при успіху. */
function useSubmit(setBusy: (busy: boolean) => void) {
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
      setBusy(false);
      closeDialog();
    } catch (err) {
      setBusy(false);
      setError(message(err));
    }
  };
  return { error, setError, run };
}

function TrackLine({ tracks }: { tracks: Track[] }) {
  const first = tracks[0];
  if (!first) return null;
  return (
    <div className="mx-6 mt-4 flex items-center gap-3 rounded-xl bg-white/[0.04] p-2.5">
      <Cover src={first.thumbnail_small} className="size-10 shrink-0" rounded="rounded-md" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold">{first.title}</p>
        <p className="truncate text-xs text-dim">
          {tracks.length > 1 ? `і ще ${plural(tracks.length - 1, "трек", "треки", "треків")}` : (first.channel ?? "—")}
        </p>
      </div>
    </div>
  );
}

function defaultName(): string {
  return `Мій плейлист №${library.getSnapshot().playlists.length + 1}`;
}

// ---------- діалоги ----------

function CreatePlaylist({ tracks, open, busy, setBusy }: BodyProps & { tracks: Track[]; open: boolean }) {
  const lib = useLibrary();
  const [name, setName] = useState(defaultName);
  const { error, run } = useSubmit(setBusy);
  const limit = lib.me?.limits.playlists ?? 100;
  const full = lib.playlists.length >= limit;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const playlist = await library.createPlaylist(name.trim(), tracks);
      if (open) router.go({ name: "playlist", id: playlist.id });
    });
  };

  return (
    <form onSubmit={submit}>
      <Head title="Новий плейлист" text={full ? undefined : "Плейлисти приватні — їх бачиш лише ти."} />
      <TrackLine tracks={tracks} />
      <div className="px-6 pt-4 pb-2">
        <TextField label="Назва" value={name} onChange={setName} maxLength={NAME_MAX} autoFocus selectOnFocus />
        <ErrorText>{full ? `Досягнуто ліміту: ${limit} плейлистів. Видали якийсь, щоб створити новий.` : error}</ErrorText>
      </div>
      <Actions>
        <Pill variant="gray" size="sm" onClick={closeDialog} disabled={busy}>
          Скасувати
        </Pill>
        <SubmitPill busy={busy} disabled={full || !name.trim()}>
          {tracks.length ? "Створити й додати" : "Створити"}
        </SubmitPill>
      </Actions>
    </form>
  );
}

function RenamePlaylist({ id, name: initial, busy, setBusy }: BodyProps & { id: number; name: string }) {
  const [name, setName] = useState(initial);
  const { error, run } = useSubmit(setBusy);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === initial) return closeDialog();
    void run(() => library.renamePlaylist(id, name.trim()));
  };
  return (
    <form onSubmit={submit}>
      <Head title="Змінити плейлист" />
      <div className="px-6 pt-4 pb-2">
        <TextField label="Назва" value={name} onChange={setName} maxLength={NAME_MAX} autoFocus selectOnFocus />
        <ErrorText>{error}</ErrorText>
      </div>
      <Actions>
        <Pill variant="gray" size="sm" onClick={closeDialog} disabled={busy}>
          Скасувати
        </Pill>
        <SubmitPill busy={busy} disabled={!name.trim()}>
          Зберегти
        </SubmitPill>
      </Actions>
    </form>
  );
}

function DeletePlaylist({ id, name, count, busy, setBusy }: BodyProps & { id: number; name: string; count: number }) {
  const { error, run } = useSubmit(setBusy);
  const remove = () =>
    void run(async () => {
      await library.deletePlaylist(id, name);
      const { route } = router.getSnapshot();
      if (route.name === "playlist" && route.id === id) router.go({ name: "library" });
    });
  return (
    <>
      <Head
        title="Видалити плейлист?"
        text={
          <>
            «<span className="font-semibold text-white">{name}</span>» ({plural(count, "трек", "треки", "треків")}) буде видалено
            назавжди. Самі треки лишаться в улюблених та інших плейлистах.
          </>
        }
      />
      <div className="px-6">
        <ErrorText>{error}</ErrorText>
      </div>
      <Actions>
        <Pill variant="gray" size="sm" onClick={closeDialog} disabled={busy}>
          Скасувати
        </Pill>
        <DangerPill busy={busy} onClick={remove}>
          <Trash2 className="size-3.5" /> Видалити
        </DangerPill>
      </Actions>
    </>
  );
}

function ImportPlaylist({ busy, setBusy }: BodyProps) {
  const lib = useLibrary();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const { error, run } = useSubmit(setBusy);
  const limit = lib.me?.limits.playlist_tracks ?? 1000;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const playlist = await library.importPlaylist(url.trim(), name.trim() || undefined);
      router.go({ name: "playlist", id: playlist.id });
    });
  };
  return (
    <form onSubmit={submit}>
      <Head title="Імпорт з YouTube" text={`Встав посилання на плейлист YouTube — перші ${limit} треків стануть твоїм плейлистом.`} />
      <div className="flex flex-col gap-4 px-6 pt-4 pb-2">
        <TextField label="Посилання" value={url} onChange={setUrl} placeholder="https://www.youtube.com/playlist?list=…" autoFocus />
        <TextField label="Назва (необов'язково)" value={name} onChange={setName} placeholder="Як у YouTube" maxLength={NAME_MAX} />
        {busy && <p className="text-xs text-dim">Читаю плейлист із YouTube — великий може зайняти до хвилини…</p>}
        <ErrorText>{error}</ErrorText>
      </div>
      <Actions>
        <Pill variant="gray" size="sm" onClick={closeDialog} disabled={busy}>
          Скасувати
        </Pill>
        <SubmitPill busy={busy} disabled={!url.trim()}>
          <Download className="size-3.5" /> Імпортувати
        </SubmitPill>
      </Actions>
    </form>
  );
}

/** «+ У плейлист»: список плейлистів (з пошуком, якщо їх багато) і «Новий плейлист». */
function AddToPlaylist({ tracks, busy, setBusy }: BodyProps & { tracks: Track[] }) {
  const lib = useLibrary();
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(lib.playlists.length === 0);
  const [name, setName] = useState(defaultName);
  const { error, run } = useSubmit(setBusy);
  const needle = filter.trim().toLowerCase();
  const playlists = needle ? lib.playlists.filter((p) => p.name.toLowerCase().includes(needle)) : lib.playlists;
  const trackLimit = lib.me?.limits.playlist_tracks ?? 1000;
  const playlistLimit = lib.me?.limits.playlists ?? 100;

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await library.createPlaylist(name.trim(), tracks);
    });
  };

  return (
    <>
      <Head title="Додати в плейлист" />
      <TrackLine tracks={tracks} />

      {creating ? (
        <form onSubmit={create}>
          <div className="px-6 pt-4 pb-2">
            <TextField label="Назва нового плейлиста" value={name} onChange={setName} maxLength={NAME_MAX} autoFocus selectOnFocus />
            <ErrorText>{lib.playlists.length >= playlistLimit ? `Досягнуто ліміту: ${playlistLimit} плейлистів.` : error}</ErrorText>
          </div>
          <Actions>
            <Pill variant="gray" size="sm" onClick={() => (lib.playlists.length ? setCreating(false) : closeDialog())} disabled={busy}>
              {lib.playlists.length ? "Назад" : "Скасувати"}
            </Pill>
            <SubmitPill busy={busy} disabled={!name.trim() || lib.playlists.length >= playlistLimit}>
              Створити й додати
            </SubmitPill>
          </Actions>
        </form>
      ) : (
        <>
          {lib.playlists.length > 6 && (
            <div className="px-6 pt-4">
              <div className="flex h-10 items-center gap-2 rounded-xl bg-[#0f0f0f] px-3 ring-1 ring-white/[0.08] focus-within:ring-white/30">
                <Search className="size-4 text-dim" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Знайти плейлист"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                />
              </div>
            </div>
          )}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/[0.06]"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-white/[0.08]">
                <Plus className="size-5" />
              </span>
              <span className="text-sm font-semibold">Новий плейлист</span>
            </button>
            {playlists.map((playlist) => {
              const full = playlist.track_count >= trackLimit;
              return (
                <button
                  key={playlist.id}
                  type="button"
                  disabled={busy || full}
                  title={full ? `У плейлисті вже ${trackLimit} треків` : undefined}
                  onClick={() => void run(() => library.addToPlaylist(playlist.id, playlist.name, tracks))}
                  className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PlaylistCover cover={playlist.cover} className="size-11 shrink-0" rounded="rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{playlist.name}</span>
                    <span className="block text-xs text-dim">{plural(playlist.track_count, "трек", "треки", "треків")}</span>
                  </span>
                  {busy ? null : <ListMusic className="size-4 shrink-0 text-faint" />}
                </button>
              );
            })}
            {needle && playlists.length === 0 && <p className="px-3 py-4 text-sm text-dim">Нічого не знайшов.</p>}
          </div>
          {(error || busy) && (
            <div className="px-6 pb-5">
              {busy && (
                <p className="flex items-center gap-2 text-xs text-dim">
                  <LoaderCircle className="size-3.5 animate-spin" /> Додаю…
                </p>
              )}
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Видалити свої дані (Privacy Policy, розділ 5). */
function DeleteData({ busy, setBusy }: BodyProps) {
  const lib = useLibrary();
  const [sure, setSure] = useState(false);
  const { error, run } = useSubmit(setBusy);
  const stats = lib.me?.stats;
  const remove = () =>
    void run(async () => {
      await library.deleteMyData();
      router.go({ name: "home" });
    });
  return (
    <>
      <Head title="Видалити мої дані?" />
      <div className="px-6 pt-3 text-sm leading-relaxed text-dim">
        <p>Буде видалено назавжди:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>профіль (ім'я, аватар, дата створення);</li>
          <li>{plural(stats?.likes ?? 0, "трек", "треки", "треків")} в улюблених;</li>
          <li>
            {plural(stats?.playlists ?? 0, "плейлист", "плейлисти", "плейлистів")} ({plural(stats?.playlist_tracks ?? 0, "трек", "треки", "треків")});
          </li>
          <li>твоє ім'я в історії «Нещодавно на сервері» (самі треки там лишаться без автора).</li>
        </ul>
        <p className="mt-3">Якщо знову відкриєш Activity, створиться новий порожній профіль.</p>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-white">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="size-4 accent-[#d61a0c]" />
          Розумію, що це не можна скасувати
        </label>
        <ErrorText>{error}</ErrorText>
      </div>
      <Actions>
        <Pill variant="gray" size="sm" onClick={closeDialog} disabled={busy}>
          Скасувати
        </Pill>
        <DangerPill busy={busy} disabled={!sure} onClick={remove}>
          <Trash2 className="size-3.5" /> Видалити назавжди
        </DangerPill>
      </Actions>
    </>
  );
}

function SubmitPill({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="inline-flex h-8 items-center justify-center gap-2 rounded-full bg-green px-4 text-xs font-semibold whitespace-nowrap text-white transition hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy && <LoaderCircle className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

function DangerPill({ busy, disabled, onClick, children }: { busy: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex h-8 items-center justify-center gap-2 rounded-full bg-heart px-4 text-xs font-semibold whitespace-nowrap text-white transition hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy && <LoaderCircle className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

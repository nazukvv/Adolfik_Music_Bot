export function fmtTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 1 трек, 2 треки, 5 треків */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

const YOUTUBE_RE = /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i;

export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  return /^https?:\/\//i.test(t) || YOUTUBE_RE.test(t);
}

/** Загальна тривалість списку: «1 год 20 хв», «42 хв», «3 хв». */
export function fmtTotal(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h) return m ? `${h} год ${m} хв` : `${h} год`;
  return `${Math.max(m, total ? 1 : 0)} хв`;
}

/** «щойно», «5 хв тому», «3 год тому», «вчора», «12.10.2026» (unix-секунди). */
export function timeAgo(unix: number): string {
  const diff = Date.now() / 1000 - unix;
  if (diff < 60) return "щойно";
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`;
  if (diff < 2 * 86400) return "вчора";
  return fmtDate(unix);
}

export function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
}

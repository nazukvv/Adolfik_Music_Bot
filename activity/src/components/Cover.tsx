import { Music } from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { media } from "../lib/media";

interface Props {
  src: string | null | undefined;
  /** Що показати, якщо src не завантажився (наприклад, mqdefault, яка є завжди). */
  fallbackSrc?: string | null;
  alt?: string;
  className?: string;
  rounded?: string;
}

/** YouTube на відсутню мініатюру віддає 404 з сірою заглушкою 120×90 — браузер вважає її «завантаженою». */
function isYouTubePlaceholder(img: HTMLImageElement): boolean {
  return img.src.includes("ytimg") && img.naturalWidth <= 120 && img.naturalHeight <= 90;
}

/** Обкладинка з плавною появою, запасною картинкою і заглушкою, якщо нічого не завантажилось. */
export function Cover({ src, fallbackSrc, alt = "", className = "", rounded = "rounded-xl" }: Props) {
  // Запам'ятовуємо, ЯКІ посилання завантажились/впали, а не булеві прапорці: закешована картинка
  // викликає onLoad ще до ефектів, і скидання прапорця в ефекті ховало б її назавжди.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());

  const primary = media(src);
  const fallback = media(fallbackSrc);
  const url = primary && !failed.has(primary) ? primary : fallback && !failed.has(fallback) ? fallback : undefined;
  const loaded = !!url && loadedSrc === url;

  const markFailed = (bad: string) => setFailed((prev) => new Set(prev).add(bad));
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    if (!url) return;
    if (isYouTubePlaceholder(e.currentTarget)) markFailed(url);
    else setLoadedSrc(url);
  };

  return (
    <div className={`relative overflow-hidden bg-raise ${rounded} ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--accent)]/25 via-white/5 to-transparent">
          <Music className="size-1/3 max-h-12 max-w-12 text-white/30" />
        </div>
      )}
      {url && (
        <img
          key={url}
          src={url}
          alt={alt}
          draggable={false}
          loading="lazy"
          onLoad={onLoad}
          onError={() => markFailed(url)}
          className={`relative size-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

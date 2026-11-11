import type { ReactNode } from "react";

type PillVariant = "green" | "gray" | "outline";

const PILL: Record<PillVariant, string> = {
  green: "bg-green text-white hover:brightness-110",
  gray: "bg-pill text-white hover:bg-[#444]",
  outline: "border border-white/70 text-white hover:border-white hover:bg-white/[0.06]",
};

/** Кнопка-пігулка з референсу: зелена Play, темно-сіра Shuffle/Змінити, контурна «В плейлист». */
export function Pill({
  variant = "gray",
  size = "md",
  onClick,
  disabled,
  title,
  className = "",
  children,
}: {
  variant?: PillVariant;
  size?: "sm" | "md";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const sizing = size === "md" ? "h-10 px-5 text-sm sm:h-11 sm:px-7 sm:text-[15px]" : "h-8 px-4 text-xs";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${sizing} ${PILL[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Кругла іконка-кнопка (плеєр, рядки таблиці). */
export function IconButton({
  label,
  disabled,
  active,
  onClick,
  size = "md",
  className = "",
  children,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`relative grid shrink-0 place-items-center rounded-full transition hover:bg-white/10 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${
        size === "md" ? "size-10" : "size-8"
      } ${active ? "text-green" : "text-white/85 hover:text-white"} ${className}`}
    >
      {children}
      {active && <span className="absolute bottom-0.5 size-1 rounded-full bg-green" />}
    </button>
  );
}

/** Круглі напівпрозорі ← → (навігація по історії сторінок). */
export function RoundNav({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full bg-white/[0.08] text-white transition hover:bg-white/[0.16] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white/[0.08]"
    >
      {children}
    </button>
  );
}

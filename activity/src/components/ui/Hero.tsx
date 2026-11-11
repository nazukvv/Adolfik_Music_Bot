import type { ReactNode } from "react";

/**
 * Шапка сторінки з референсу: декоративні кола й дуги, маленький підпис над заголовком,
 * жирний заголовок ~40px, сірий підпис і кнопки-пігулки (праворуч на широкому екрані).
 */
export function Hero({
  label,
  labelIcon,
  title,
  subtitle,
  art,
  actions,
  children,
}: {
  label: string;
  labelIcon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Обкладинка/колаж ліворуч від заголовка. */
  art?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    // Зверху — місце під липку TopBar (64px): кола шапки заходять під кнопки ← →, як у референсі.
    <section className="relative overflow-hidden px-4 pt-[84px] pb-6 sm:px-8 sm:pt-[104px] sm:pb-8 short:pt-[76px] short:pb-5">
      <HeroCircles />
      <div className="relative flex flex-col gap-5 short:gap-4 @4xl:flex-row @4xl:items-end @4xl:justify-between">
        <div className="flex min-w-0 items-end gap-5">
          {art && <div className="hidden shrink-0 sm:block">{art}</div>}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-dim">
              {labelIcon && <span className="text-green [&>svg]:size-3.5">{labelIcon}</span>}
              {label}
            </p>
            <h1 className="mt-1.5 line-clamp-2 text-[28px] leading-[1.15] font-bold tracking-tight break-words sm:text-[40px] short:text-[34px]">
              {title}
            </h1>
            {subtitle && <div className="mt-1.5 line-clamp-2 text-sm text-dim">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Великі напівпрозорі кола, що виходять за край (як у референсі). */
function HeroCircles() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -top-[260px] right-[-140px] size-[520px] rounded-full border border-white/[0.07] bg-gradient-to-b from-white/[0.035] to-transparent" />
      <div className="absolute -top-[120px] right-[160px] size-[300px] rounded-full border border-white/[0.05]" />
      <div className="absolute top-[40%] right-[-60px] size-[220px] rounded-full border border-white/[0.04]" />
    </div>
  );
}

/** Текстові вкладки (активна — біла з білою смужкою). */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="flex gap-6 overflow-x-auto px-4 sm:px-8" role="tablist">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`relative shrink-0 pb-2.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
              active ? "text-white" : "text-dim hover:text-white"
            }`}
          >
            {item.label}
            {active && <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-white" />}
          </button>
        );
      })}
    </div>
  );
}

/** Заголовок секції всередині сторінки. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 px-4 sm:px-8">
      <h2 className="text-lg font-bold">{children}</h2>
      {action}
    </div>
  );
}

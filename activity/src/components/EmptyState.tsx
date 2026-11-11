import { motion } from "motion/react";
import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Гарна заглушка замість порожнього екрана. */
export function EmptyState({ icon, title, text, action, className = "" }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col items-center px-6 py-10 text-center ${className}`}
    >
      <div className="relative mb-5 grid size-24 place-items-center">
        <div className="absolute inset-0 rounded-full bg-[var(--accent)] opacity-25 blur-2xl transition-colors duration-700" />
        <div className="relative grid size-20 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.02] text-[var(--accent)] transition-colors duration-700 [&>svg]:size-9">
          {icon}
        </div>
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {text && <p className="mt-2 max-w-sm text-sm leading-relaxed text-dim">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full bg-green px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

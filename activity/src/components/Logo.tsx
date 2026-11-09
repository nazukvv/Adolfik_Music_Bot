import { AudioLines } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-[var(--accent)] shadow-[0_0_28px_-6px_var(--accent)] transition-colors duration-700">
        <AudioLines className="size-5 text-black/80" strokeWidth={2.5} />
      </div>
      {!compact && <span className="text-lg font-bold tracking-tight">Adolfik</span>}
    </div>
  );
}

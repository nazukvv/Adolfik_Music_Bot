import { AudioLines } from "lucide-react";

/** Знак Adolfik: зелений квадрат-хвиля + назва. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <div className="grid size-8 place-items-center rounded-lg bg-green">
        <AudioLines className="size-[18px] text-white" strokeWidth={2.5} />
      </div>
      {!compact && <span className="text-[19px] font-semibold tracking-tight">Adolfik</span>}
    </div>
  );
}

import { AnimatePresence, motion } from "motion/react";
import { dismiss, useToasts } from "../lib/toasts";

export function Toasts({ bottom = 112 }: { bottom?: number }) {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4" style={{ bottom }}>
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto max-w-md rounded-full border px-4 py-2 text-sm shadow-2xl backdrop-blur-xl ${
              t.kind === "error"
                ? "border-red-400/30 bg-red-950/85 text-red-100"
                : "border-white/10 bg-[#222]/95 text-white"
            }`}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

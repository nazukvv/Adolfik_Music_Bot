import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ListMusic, X } from "lucide-react";
import { jumpTo, moveInQueue, removeFromQueue } from "../../lib/actions";
import { fmtTime, plural } from "../../lib/format";
import { media } from "../../lib/media";
import type { Track } from "../../lib/types";
import { Cover } from "../Cover";
import { LikeButton } from "../ui/Bits";

interface Props {
  queue: Track[];
  total: number;
  duration: number;
  canControl: boolean;
}

export function QueueList({ queue, total, duration, canControl }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const keys = queue.map((t) => t.key);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from >= 0 && to >= 0) void moveInQueue(queue, from, to);
  };

  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Далі в черзі</h3>
        {total > 0 && (
          <span className="text-xs text-faint tabular-nums">
            {plural(total, "трек", "треки", "треків")} · {fmtTime(duration)}
          </span>
        )}
      </header>

      {queue.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-5 text-[13px] text-dim">
          <ListMusic className="size-5 shrink-0" />
          Черга порожня — додай щось із пошуку
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={keys} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-0.5">
              {queue.map((track, index) => (
                <QueueRow key={track.key} track={track} index={index} queue={queue} canControl={canControl} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {total > queue.length && (
        <p className="mt-2 px-2 text-xs text-faint">… і ще {plural(total - queue.length, "трек", "треки", "треків")}</p>
      )}
    </section>
  );
}

function QueueRow({
  track,
  index,
  queue,
  canControl,
}: {
  track: Track;
  index: number;
  queue: Track[];
  canControl: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.key,
    disabled: !canControl,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex items-stretch gap-2 rounded-xl px-1.5 transition-colors ${
        isDragging ? "z-10 bg-raise shadow-2xl ring-1 ring-white/10" : "hover:bg-white/[0.05]"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={!canControl}
        aria-label="Перетягни, щоб змінити порядок"
        className="grid w-5 shrink-0 cursor-grab touch-none place-items-center text-faint transition-colors hover:text-white active:cursor-grabbing disabled:cursor-default disabled:opacity-0"
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => canControl && void jumpTo(queue, index)}
        disabled={!canControl}
        title={canControl ? "Перейти на цей трек" : track.title}
        className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left disabled:cursor-default"
      >
        <Cover src={track.thumbnail_small} className="size-10 shrink-0" rounded="rounded-md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{track.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-dim">
            <span className="truncate">{track.channel ?? "—"}</span>
            <span className="shrink-0 tabular-nums">· {track.is_live ? "наживо" : fmtTime(track.duration)}</span>
          </span>
        </span>
        {track.requester?.avatar && (
          <img
            src={media(track.requester.avatar)}
            alt=""
            title={`Замовив ${track.requester.name ?? ""}`}
            className="size-5 shrink-0 rounded-full opacity-70"
          />
        )}
      </button>
      <LikeButton track={track} size="sm" className="self-center opacity-60 group-hover:opacity-100 touch:opacity-100" />
      {canControl && (
        <button
          type="button"
          onClick={() => void removeFromQueue(queue, index)}
          aria-label="Прибрати з черги"
          title="Прибрати з черги"
          className="grid size-8 shrink-0 place-items-center self-center rounded-full text-faint opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </li>
  );
}

"use client";

import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";

export type DayItem = { id: number | "new"; start: string; end: string; title: string; sub?: string | null };

const HOUR = 44; // px per hour
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// One day as a timeline: what's already booked, and the new appointment (in
// green) where it fits. Visits that overlap sit side by side.
export function DayView({ items }: { items: DayItem[] }) {
  const { tr, fmt } = useI18n();
  const clock = fmt.clock;
  const firstHour = Math.min(8, ...items.map((i) => Math.floor(toMin(i.start) / 60)));
  const lastHour = Math.max(18, ...items.map((i) => Math.ceil(toMin(i.end) / 60)));
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);

  // side-by-side lanes for overlapping visits
  const sorted = [...items].sort((a, b) => toMin(a.start) - toMin(b.start));
  const laneEnds: number[] = [];
  const lane = new Map<DayItem["id"], number>();
  for (const it of sorted) {
    let l = laneEnds.findIndex((end) => end <= toMin(it.start));
    if (l === -1) l = laneEnds.push(0) - 1;
    laneEnds[l] = toMin(it.end);
    lane.set(it.id, l);
  }
  const lanes = Math.max(1, laneEnds.length);

  return (
    <div className="relative" style={{ height: (lastHour - firstHour) * HOUR + 8 }} role="list" aria-label={tr("That day's schedule")}>
      {hours.map((h) => (
        <div key={h} className="absolute inset-x-0 flex items-start gap-2" style={{ top: (h - firstHour) * HOUR }}>
          <span className="w-12 shrink-0 -translate-y-1.5 text-right text-[0.65rem] text-muted-foreground tabular-nums">{clock(`${String(h).padStart(2, "0")}:00`).replace(":00", "")}</span>
          <span className="mt-0 h-px flex-1 bg-border" />
        </div>
      ))}
      <div className="absolute inset-y-0 right-0 left-14">
        {sorted.map((it) => {
          const top = ((toMin(it.start) - firstHour * 60) / 60) * HOUR;
          const height = Math.max(22, ((toMin(it.end) - toMin(it.start)) / 60) * HOUR - 2);
          const isNew = it.id === "new";
          return (
            <div
              key={it.id}
              role="listitem"
              className={cn(
                "absolute overflow-hidden rounded-md border px-2 py-1 text-[0.7rem] leading-tight",
                isNew ? "z-10 border-brand-green bg-brand-green/15 shadow-[0_0_0_2px_color-mix(in_oklab,var(--brand-green)_30%,transparent)]" : "border-brand-blue/30 bg-brand-blue/10",
              )}
              style={{ top, height, left: `${(lane.get(it.id)! / lanes) * 100}%`, width: `calc(${100 / lanes}% - 4px)` }}
            >
              <p className={cn("truncate font-semibold", isNew && "text-brand-green")}>
                {isNew && "New: "}
                {it.title}
              </p>
              <p className="truncate text-muted-foreground">
                {clock(it.start)} – {clock(it.end)}
                {it.sub ? ` · ${it.sub}` : ""}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

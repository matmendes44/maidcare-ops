"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";
import { plural } from "@/lib/i18n/tr";
import { monthBusy } from "./actions";
import { addDays, addMonths, startOfMonth, startOfWeek } from "./options";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
// every 15 minutes from 6:00 AM to 9:00 PM, plus a time already chosen off that grid
const slots = (from: number, to: number, keep: string) => {
  const list: string[] = [];
  for (let m = from; m <= to; m += 15) list.push(toTime(m));
  if (keep && !list.includes(keep)) list.push(keep);
  return list.sort();
};
const LENGTHS = [60, 90, 120, 180, 240];

// A month you can swipe or step through; days with visits get dots.
function MonthGrid({ value, onPick, today, invalid }: { value: string; onPick: (date: string) => void; today: string; invalid?: boolean }) {
  const [month, setMonth] = useState(startOfMonth(value || today));
  const [busy, setBusy] = useState<Record<string, number>>({});
  const touch = useRef<number | null>(null);
  const { tr, fmt } = useI18n();

  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const b = await monthBusy(month);
      if (live) setBusy(b);
    });
    return () => {
      live = false;
    };
  }, [month]);

  const first = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i)).filter((d, i) => i < 35 || d.slice(0, 7) === month.slice(0, 7));
  const step = (n: number) => setMonth(addMonths(month, n));

  return (
    <div
      className={cn("rounded-xl border bg-card p-3 select-none", invalid && "border-destructive ring-3 ring-destructive/20")}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => step(-1)} aria-label={tr("Previous month")} className="grid size-10 place-items-center rounded-full hover:bg-secondary">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <p className="font-semibold" aria-live="polite">
          {fmt.monthYear(month)}
        </p>
        <button type="button" onClick={() => step(1)} aria-label={tr("Next month")} className="grid size-10 place-items-center rounded-full hover:bg-secondary">
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[0.7rem] font-medium text-muted-foreground uppercase">
        {fmt.weekdays.short.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          const n = busy[d] ?? 0;
          const on = d === value;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-pressed={on}
              aria-label={`${fmt.fullDay(d)}${n ? `, ${plural(tr, n, "{n} appointment", "{n} appointments")}` : ""}`}
              className={cn(
                "mx-auto grid size-11 place-content-center gap-0.5 rounded-full text-sm tabular-nums transition-colors",
                !inMonth && "text-muted-foreground/40",
                inMonth && d < today && !on && "text-muted-foreground",
                d === today && !on && "font-bold text-brand-blue ring-1 ring-brand-blue/40",
                on ? "bg-brand-blue font-semibold text-white" : "hover:bg-secondary",
              )}
            >
              {Number(d.slice(8))}
              <span className="flex h-1 justify-center gap-0.5">
                {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                  <span key={i} className={cn("size-1 rounded-full", on ? "bg-white" : "bg-brand-green")} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The schedule: the month calendar, then, once a day is picked, the start
// and end times sliding up underneath. Sends date, start and end with the form.
// With exactTimes (the owner) the times are typed to the minute instead of
// picked from the 15-minute list.
export function BookingCalendar({
  date,
  start,
  end,
  today,
  onChange,
  invalid,
  exactTimes = false,
}: {
  date: string;
  start: string;
  end: string;
  today: string;
  onChange: (v: { date: string; start: string; end: string }) => void;
  invalid: { date?: boolean; start?: boolean; end?: boolean };
  exactTimes?: boolean;
}) {
  const { tr, fmt } = useI18n();
  const length = toMin(end) - toMin(start);
  const setStart = (s: string) => {
    // keep the same length when the start moves
    const len = length > 0 ? length : 120;
    onChange({ date, start: s, end: toTime(Math.min(toMin(s) + len, 23 * 60 + 45)) });
  };
  return (
    <div className="grid gap-3">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <MonthGrid value={date} today={today} invalid={invalid.date} onPick={(d) => onChange({ date: d, start, end })} />

      {date && (
        <div className="animate-in fade-in-0 slide-in-from-bottom-4 grid gap-3 rounded-xl border bg-card p-4 shadow-sm duration-200">
          <p className="font-semibold">{fmt.fullDay(date)}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="start-time">{tr("Start")}</Label>
              {exactTimes ? (
                <Input id="start-time" type="time" step={60} value={start} onChange={(e) => e.target.value && setStart(e.target.value)} aria-invalid={invalid.start || undefined} className="h-12 text-base" />
              ) : (
                <NativeSelect id="start-time" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={invalid.start || undefined} className="h-12 w-full text-base">
                  {slots(6 * 60, 21 * 60, start).map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {fmt.clock(t)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="end-time">{tr("End")}</Label>
              {exactTimes ? (
                <Input id="end-time" type="time" step={60} value={end} onChange={(e) => onChange({ date, start, end: e.target.value })} aria-invalid={invalid.end || undefined} className="h-12 text-base" />
              ) : (
                <NativeSelect id="end-time" value={end} onChange={(e) => onChange({ date, start, end: e.target.value })} aria-invalid={invalid.end || undefined} className="h-12 w-full text-base">
                  {slots(toMin(start) + 15, 23 * 60 + 45, end).map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {fmt.clock(t)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={tr("How long")}>
            {LENGTHS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ date, start, end: toTime(Math.min(toMin(start) + m, 23 * 60 + 45)) })}
                aria-pressed={length === m}
                className={cn("h-9 rounded-full border px-3.5 text-sm font-medium transition-colors", length === m ? "border-brand-blue bg-brand-blue/10 text-brand-blue" : "hover:bg-secondary")}
              >
                {m % 60 ? `${m / 60} h` : `${m / 60} h`.replace(".0", "")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

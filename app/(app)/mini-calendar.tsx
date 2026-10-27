import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { getI18n } from "@/lib/i18n/server";
import { today as getToday } from "@/lib/today";
import { getAppointmentsBetween } from "./appointments/data";
import { addDays, addMonths, startOfMonth, startOfWeek, toLocalInputs } from "./appointments/options";


// A small month calendar for the dashboard. Days with appointments get a
// dot; every day opens in the appointments calendar.
// `bare` drops its own card frame (inside a dashboard widget).
export async function MiniCalendar({ bare = false }: { bare?: boolean } = {}) {
  const [today, { t, fmt }] = await Promise.all([getToday(), getI18n()]);
  const month = startOfMonth(today);
  const gridStart = startOfWeek(month);
  const gridEnd = startOfWeek(addDays(addMonths(month, 1), 6));
  const rows = await getAppointmentsBetween(gridStart, gridEnd);

  // booked (not canceled) appointments per day, and whether any are pending
  const perDay = new Map<string, { count: number; pending: boolean }>();
  for (const r of rows) {
    if (r.status === "canceled") continue;
    const day = toLocalInputs(r.scheduledStart).date;
    const entry = perDay.get(day) ?? { count: 0, pending: false };
    entry.count++;
    entry.pending ||= r.status === "pending" || r.status === "in_progress";
    perDay.set(day, entry);
  }
  const days: string[] = [];
  for (let d = gridStart; d < gridEnd; d = addDays(d, 1)) days.push(d);
  const todayCount = perDay.get(today)?.count ?? 0;

  return (
    <section aria-labelledby="mini-calendar-title" className={bare ? "" : "rounded-xl border bg-card p-5"}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="mini-calendar-title" className="flex items-center gap-2 text-lg font-semibold">
          <CalendarDays className="size-5 text-brand-green" aria-hidden="true" />
          <Link href={`/appointments?view=month&date=${month}`} className="hover:text-link hover:underline underline-offset-4">
            {fmt.monthYear(month)}
          </Link>
        </h2>
        <Link
          href={`/appointments?view=month&date=${month}`}
          className="inline-flex items-center gap-0.5 text-sm font-medium text-link hover:underline underline-offset-4"
        >
          {t.nav.appointments}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-7 text-center text-[0.75rem] font-semibold text-muted-foreground" aria-hidden="true">
        {fmt.weekdays.narrow.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <ol className="mt-1 grid grid-cols-7 gap-y-1">
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === month.slice(0, 7);
          const booked = perDay.get(day);
          const isToday = day === today;
          return (
            <li key={day} className="grid place-items-center">
              <Link
                href={`/appointments?view=day&date=${day}`}
                aria-label={t.miniCalendar.dayLabel(fmt.dayHeading(day), booked?.count ?? 0)}
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "relative grid size-9 place-items-center rounded-full text-sm tabular-nums transition-colors hover:bg-secondary",
                  !inMonth && "text-muted-foreground/60",
                  booked && inMonth && "font-semibold",
                  isToday && "bg-brand-blue font-semibold text-white hover:bg-brand-blue/90",
                )}
              >
                {Number(day.slice(8))}
                {booked && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute bottom-1 size-1 rounded-full",
                      isToday ? "bg-white" : booked.pending ? "bg-brand-blue" : "bg-brand-green",
                    )}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-sm">
        <Link href={`/appointments?view=day&date=${today}`} className="font-medium hover:text-link hover:underline underline-offset-4">
          {t.miniCalendar.todayCount(todayCount)}
        </Link>
        <span className="flex items-center gap-3 text-[0.75rem] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-brand-blue" aria-hidden="true" /> {t.miniCalendar.pending}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-brand-green" aria-hidden="true" /> {t.miniCalendar.done}
          </span>
        </span>
      </div>
    </section>
  );
}

export function MiniCalendarFallback() {
  return <div className="h-[23rem] animate-pulse rounded-xl border bg-muted/40" aria-hidden="true" />;
}

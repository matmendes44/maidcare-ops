"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { Input } from "@/components/ui/input";

// Jumps the calendar to a chosen day (day and week views) or month (month
// view). Typing into a date input produces a valid value after almost every
// keystroke (09/1 → Sep 1, then 09/15), so it waits for a pause before
// navigating, and ignores half-typed years like 0002.
export function GoToDate({ view, date }: { view: "day" | "week" | "month"; date: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const isMonth = view === "month";
  const shown = isMonth ? date.slice(0, 7) : date;
  const [value, setValue] = useState(shown);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // follow the calendar when it moves by other means (arrows, Today, links)
  const [prevShown, setPrevShown] = useState(shown);
  if (shown !== prevShown) {
    setPrevShown(shown);
    setValue(shown);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function change(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    if (!(isMonth ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(next)) return;
    const year = Number(next.slice(0, 4));
    if (year < 2000 || year > 2100 || next === shown) return;
    timer.current = setTimeout(() => {
      router.push(`/appointments?view=${view}&date=${isMonth ? `${next}-01` : next}`);
    }, 400);
  }

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      {t.appointments.goTo}
      <Input
        type={isMonth ? "month" : "date"}
        value={value}
        onChange={(e) => change(e.target.value)}
        aria-label={isMonth ? t.appointments.goToMonth : t.appointments.goToDate}
        className="h-9 w-auto text-foreground"
      />
    </label>
  );
}

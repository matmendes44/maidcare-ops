// Locale-aware formatting of dates, times and money. Timestamps are shown in
// the business's time zone; date-only values ("YYYY-MM-DD") are formatted as
// calendar dates so they never shift a day.
import { TIME_ZONE, type Locale } from "./config";

function make(locale: Locale) {
  const tz = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, ...options });
  const cal = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });
  const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

  const day = tz({ weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = tz({ hour: "numeric", minute: "2-digit" });
  const stamp = tz({ dateStyle: "medium", timeStyle: "short" });
  const date = tz({ dateStyle: "medium" });
  const calendarDate = cal({ dateStyle: "medium" });
  const dayHeading = cal({ weekday: "long", month: "long", day: "numeric" });
  const fullDay = cal({ weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const monthYear = cal({ month: "long", year: "numeric" });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  const moneyWhole = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const shortDay = cal({ weekday: "short", month: "short", day: "numeric" });
  const monthDay = cal({ month: "short", day: "numeric" });
  const clock = cal({ hour: "numeric", minute: "2-digit" });
  const number = new Intl.NumberFormat(locale);
  const weekdayShort = cal({ weekday: "short" });
  const weekdayNarrow = cal({ weekday: "narrow" });
  const weekdayLong = cal({ weekday: "long" });
  // 2024-01-01 was a Monday; weeks start on Monday
  const monday = Date.UTC(2024, 0, 1);
  const week = (f: Intl.DateTimeFormat) =>
    Array.from({ length: 7 }, (_, i) => f.format(new Date(monday + i * 86400000)));

  return {
    /** "Mon, Jan 7, 2030" for a timestamp */
    day: (iso: string) => day.format(new Date(iso)),
    /** "9:00 AM" */
    time: (iso: string) => time.format(new Date(iso)),
    /** "9:00 AM – 11:00 AM" */
    timeRange: (start: string, end: string) => `${time.format(new Date(start))} – ${time.format(new Date(end))}`,
    /** "Oct 16, 2026, 8:38 PM" */
    stamp: (iso: string) => stamp.format(new Date(iso)),
    /** "Oct 16, 2026" for a timestamp */
    date: (iso: string) => date.format(new Date(iso)),
    /** "Oct 16, 2026" for a "YYYY-MM-DD" date */
    calendarDate: (iso: string) => calendarDate.format(asDate(iso)),
    /** "Monday, January 7" for a "YYYY-MM-DD" date */
    dayHeading: (iso: string) => dayHeading.format(asDate(iso)),
    /** "Monday, January 7, 2030" for a "YYYY-MM-DD" date */
    fullDay: (iso: string) => fullDay.format(asDate(iso)),
    /** "January 2030" for a "YYYY-MM-DD" date */
    monthYear: (iso: string) => monthYear.format(asDate(iso)),
    /** "$150.00" */
    money: (cents: number) => money.format(cents / 100),
    /** "$150" */
    moneyWhole: (cents: number) => moneyWhole.format(cents / 100),
    /** "1,234" */
    number: (n: number) => number.format(n),
    /** "Mon, Jan 7" for a "YYYY-MM-DD" date */
    shortDay: (iso: string) => shortDay.format(asDate(iso)),
    /** "Jan 7" for a "YYYY-MM-DD" date */
    monthDay: (iso: string) => monthDay.format(asDate(iso)),
    /** "9:00 AM" for a wall-clock "HH:MM" */
    clock: (hhmm: string) => clock.format(new Date(`1970-01-01T${hhmm.slice(0, 5)}:00Z`)),
    /** "2 h 30 min" */
    duration: (start: string, end: string) => {
      const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ") || "0 min";
    },
    /** Monday-first weekday names */
    weekdays: { short: week(weekdayShort), narrow: week(weekdayNarrow), long: week(weekdayLong) },
    /** Sunday-first long weekday name for a JS day number (0 = Sunday) */
    weekdayName: (jsDay: number) => weekdayLong.format(new Date(monday + ((jsDay + 6) % 7) * 86400000)),
  };
}

export type Formatters = ReturnType<typeof make>;

const cache = new Map<Locale, Formatters>();
export function formatters(locale: Locale): Formatters {
  let f = cache.get(locale);
  if (!f) cache.set(locale, (f = make(locale)));
  return f;
}

// Date ranges for the Reports page. Days are "YYYY-MM-DD" in Eastern time,
// both ends included. Pure functions: no database, easy to test.

export const presets = ["month", "last-month", "3m", "ytd", "12m", "all", "custom"] as const;
export type Preset = (typeof presets)[number];
export type Range = { preset: Preset; from: string; to: string };

// (shown through tr())
export const presetLabels: Record<Preset, string> = {
  month: "This month",
  "last-month": "Last month",
  "3m": "Last 3 months",
  ytd: "Year to date",
  "12m": "Last 12 months",
  all: "All time",
  custom: "Custom",
};

const DAY = 86_400_000;
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => toDay(new Date(toDate(day).getTime() + n * DAY));
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const addMonths = (day: string, n: number) => {
  const d = toDate(monthStart(day));
  d.setUTCMonth(d.getUTCMonth() + n);
  return toDay(d);
};
export const daysIn = (r: { from: string; to: string }) => Math.round((toDate(r.to).getTime() - toDate(r.from).getTime()) / DAY) + 1;

// Earliest day "All time" reaches back to.
export const ALL_TIME_START = "2020-01-01";

export function resolveRange(params: { range?: string; from?: string; to?: string }, today: string): Range {
  const preset = (presets as readonly string[]).includes(params.range ?? "") ? (params.range as Preset) : "12m";
  switch (preset) {
    case "month":
      return { preset, from: monthStart(today), to: today };
    case "last-month":
      return { preset, from: addMonths(today, -1), to: addDays(monthStart(today), -1) };
    case "3m":
      return { preset, from: addMonths(today, -2), to: today };
    case "ytd":
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { preset, from: ALL_TIME_START, to: today };
    case "custom": {
      if (!isDay(params.from) || !isDay(params.to)) return resolveRange({ range: "12m" }, today);
      const [from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
      return { preset, from, to: to > today ? today : to };
    }
    default:
      return { preset: "12m", from: addMonths(today, -11), to: today };
  }
}

// The same number of days right before, to compare with ("vs previous period").
export function previousRange(r: { from: string; to: string }) {
  const n = daysIn(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

// "2026-08", "2026-09", … for every month the range touches.
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) out.push(m.slice(0, 7));
  return out;
}

// Mondays of the weeks the range touches.
export function weeksBetween(from: string, to: string) {
  const d = toDate(from);
  const monday = toDay(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY));
  const out: string[] = [];
  for (let w = monday; w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

export const monthLabel = (ym: string, locale = "en-US") =>
  new Date(`${ym}-01T12:00:00Z`).toLocaleDateString(locale, { month: "short", year: "2-digit", timeZone: "UTC" });

// Percent change from `before` to `now`; null when there's nothing to compare.
export function change(now: number, before: number) {
  if (!before) return null;
  return (now - before) / Math.abs(before);
}

// Visits a month for each service-plan frequency, for monthly recurring revenue.
export const visitsPerMonth: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  every_4_weeks: 13 / 12,
  monthly: 1,
  every_2_months: 0.5,
  one_time: 0,
};

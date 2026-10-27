// Recurring visits: when the next ones are expected. Pure functions, shared by
// the server and the tests. Days are Eastern "YYYY-MM-DD", times "HH:MM".

export const FREQUENCIES = ["weekly", "biweekly", "every_3_weeks", "every_4_weeks", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const frequencyLabel: Record<Frequency, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  every_3_weeks: "Every 3 weeks",
  every_4_weeks: "Every 4 weeks",
  monthly: "Monthly (same week)",
};
export const isFrequency = (v: unknown): v is Frequency => typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);
// days between visits; monthly follows the calendar instead
const stepDays: Record<Exclude<Frequency, "monthly">, number> = { weekly: 7, biweekly: 14, every_3_weeks: 21, every_4_weeks: 28 };
// visits a month, for expected monthly revenue
export const visitsPerMonth = (f: Frequency) => (f === "monthly" ? 1 : 365.25 / 12 / stepDays[f]);

// An estimate's recurring line ("Every 2 weeks", "Monthly") → its frequency
export function frequencyFromLabel(label: string): Frequency | null {
  const l = label.trim().toLowerCase();
  if (l === "every week" || l === "weekly") return "weekly";
  if (l.startsWith("monthly") || l === "every month") return "monthly";
  const m = /^every (\d) weeks$/.exec(l);
  return m ? ({ "2": "biweekly", "3": "every_3_weeks", "4": "every_4_weeks" } as Record<string, Frequency>)[m[1]] ?? null : null;
}

// how far ahead expected visits show, and when to start asking for an invoice
export const LOOKAHEAD_DAYS = 28;
export const PROMPT_DAYS = 7;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// To the nearest half hour; exactly between rounds down (10:23 → 10:30,
// 10:15 → 10:00, 10:45 → 10:30).
export function roundToHalfHour(time: string) {
  const m = toMin(time);
  const r = m % 30;
  return toTime(Math.min(23 * 60 + 30, r > 15 ? m - r + 30 : m - r));
}

// The same week and weekday a month later: the 2nd Tuesday → next month's
// 2nd Tuesday. A visit in a month's 5th week (day 29–31) goes to the next
// month's last such weekday.
export function sameWeekNextMonth(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.getUTCDay();
  const nth = Math.ceil(d.getUTCDate() / 7); // 1–5
  const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1) % 12;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const first = 1 + ((weekday - new Date(Date.UTC(y, m, 1)).getUTCDay() + 7) % 7);
  let target = first + (nth - 1) * 7;
  while (target > days) target -= 7; // no 5th one that month: the last
  return new Date(Date.UTC(y, m, target)).toISOString().slice(0, 10);
}

const next = (day: string, f: Frequency) => (f === "monthly" ? sameWeekNextMonth(day) : addDays(day, stepDays[f]));

// The next visits after the last one, from `from` to `to` (both included).
// A skipped day is left out but the rhythm carries on from it; days before
// `pausedUntil` are left out too.
export function expectedDays(lastDay: string, frequency: Frequency, o: { from: string; to: string; skips?: Set<string>; pausedUntil?: string | null }) {
  const out: string[] = [];
  for (let d = next(lastDay, frequency); d <= o.to; d = next(d, frequency)) {
    if (d < o.from || o.skips?.has(d) || (o.pausedUntil && d < o.pausedUntil)) continue;
    out.push(d);
  }
  return out;
}

// The expected time on those days: the last visit's start (when the crew
// actually arrived, if known) to the nearest half hour, for as long as it
// was booked.
export function expectedTime(lastStart: string, lastMinutes: number) {
  const start = roundToHalfHour(lastStart);
  const minutes = Math.max(30, Math.round(lastMinutes / 30) * 30 || 120);
  return { start, end: toTime(Math.min(toMin(start) + minutes, 23 * 60 + 59)) };
}

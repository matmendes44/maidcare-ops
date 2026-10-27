// Due dates for recurring expenses, which of them have been paid, and what's
// expected each month. Days are "YYYY-MM-DD". Pure functions: no database,
// easy to test.
import type { Frequency } from "./options";

export type Schedule = { frequency: Frequency; startDate: string; endDate: string | null; amountCents: number };

const DAY = 86_400_000;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => toDay(new Date(toDate(day).getTime() + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

// Roughly how long one period is, for matching payments to due dates.
export const periodDays: Record<Frequency, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };
const monthsPer: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, yearly: 12 };

// The k-th due date (k = 0 is the start). Monthly dates keep the start's day,
// or the month's last day when it's shorter: Jan 31 → Feb 28 → Mar 31.
export function nthDue(s: Pick<Schedule, "frequency" | "startDate">, k: number): string {
  const months = monthsPer[s.frequency];
  if (!months) return addDays(s.startDate, k * periodDays[s.frequency]);
  const start = toDate(s.startDate);
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k * months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return toDay(target);
}

// Due dates from `from` to `to` (both included), within the schedule's start
// and end.
export function dueDates(s: Schedule, from: string, to: string): string[] {
  const last = s.endDate && s.endDate < to ? s.endDate : to;
  if (last < s.startDate || last < from) return [];
  // jump close to `from` instead of walking from the start
  let k = Math.max(0, Math.floor(daysBetween(s.startDate, from) / periodDays[s.frequency]) - 1);
  const out: string[] = [];
  for (let due = nthDue(s, k); due <= last; due = nthDue(s, ++k)) if (due >= from) out.push(due);
  return out;
}

// The expected total of each month ("YYYY-MM") from the given schedules.
export function expectedByMonth(schedules: Schedule[], months: string[]): number[] {
  return months.map((m) => {
    const from = `${m}-01`;
    const to = addDays(toDay(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1))), -1);
    return schedules.reduce((sum, s) => sum + dueDates(s, from, to).length * s.amountCents, 0);
  });
}

export type ScheduleState = "paid" | "upcoming" | "due" | "overdue" | "not_started" | "ended";
export type ScheduleStatus = {
  state: ScheduleState;
  // the due date the state is about: the one that's due or overdue, else the next one
  dueDate: string | null;
  nextDue: string | null;
  // earlier due dates (within the last year) with no payment recorded
  missed: string[];
};

// Days after a due date before it counts as overdue, and how soon a due date
// counts as upcoming.
export const GRACE_DAYS = 3;
export const UPCOMING_DAYS = 7;

// A due date counts as paid when a payment linked to the schedule is dated
// within half a period of it (a bill paid a few days early or late still
// counts), and each payment counts once.
export function scheduleStatus(s: Schedule, paymentDates: string[], today: string): ScheduleStatus {
  const half = Math.ceil(periodDays[s.frequency] / 2);
  const past = dueDates(s, addDays(today, -365), today);
  const unused = [...paymentDates].sort();
  const paid = (due: string) => {
    const i = unused.findIndex((p) => Math.abs(daysBetween(due, p)) < half);
    if (i === -1) return false;
    unused.splice(i, 1);
    return true;
  };
  const paidFlags = past.map(paid);
  const upcoming = dueDates(s, addDays(today, 1), addDays(today, 400))[0] ?? null;
  // a payment recorded early for the next due date
  const nextPaid = upcoming !== null && paid(upcoming);
  const nextUnpaid = nextPaid ? (dueDates(s, addDays(upcoming, 1), addDays(upcoming, 400))[0] ?? null) : upcoming;

  if (today < s.startDate) return { state: "not_started", dueDate: s.startDate, nextDue: s.startDate, missed: [] };
  const current = past.at(-1) ?? null;
  const currentPaid = paidFlags.at(-1) ?? true;
  const missed = past.slice(0, -1).filter((_, i) => !paidFlags[i]);
  if (s.endDate && s.endDate < today && currentPaid) return { state: "ended", dueDate: null, nextDue: null, missed };
  if (current && !currentPaid) {
    const late = daysBetween(current, today);
    return { state: late > GRACE_DAYS ? "overdue" : "due", dueDate: current, nextDue: nextUnpaid, missed };
  }
  if (nextUnpaid && daysBetween(today, nextUnpaid) <= UPCOMING_DAYS) return { state: "upcoming", dueDate: nextUnpaid, nextDue: nextUnpaid, missed };
  return { state: "paid", dueDate: nextUnpaid, nextDue: nextUnpaid, missed };
}

// What one schedule costs in a year, for ranking subscriptions.
const perYear: Record<Frequency, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };
export const yearlyCost = (s: Pick<Schedule, "frequency" | "amountCents">) => s.amountCents * perYear[s.frequency];

// What contractors earn from the visits they worked. Pure functions: no
// database, easy to test. Days are "YYYY-MM-DD" (Eastern).
//
// Today contractors get a day rate: one day's pay for each day they're on at
// least one completed visit, however many visits. A rate can instead be a
// percent of each visit's price (split evenly between the contractors on
// it); that's ready for when pay moves to a share of each cleaning.

export type PayRate = { effectiveFrom: string; payType: "day_rate" | "percent"; dayRateCents: number | null; percentBp: number | null };
export type WorkedVisit = { appointmentId: number; day: string; priceCents: number; contractorsOnVisit: number };
export type WorkedDay = { day: string; visits: WorkedVisit[]; rate: PayRate | null; cents: number };

// The rate in force on a day: the latest one that started on or before it.
export function rateOn(rates: PayRate[], day: string): PayRate | null {
  let best: PayRate | null = null;
  for (const r of rates) if (r.effectiveFrom <= day && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best;
}

export function visitShare(rate: PayRate, v: WorkedVisit) {
  return Math.round((v.priceCents * (rate.percentBp ?? 0)) / 10000 / Math.max(1, v.contractorsOnVisit));
}

export function earnings(visits: WorkedVisit[], rates: PayRate[]) {
  const byDay = new Map<string, WorkedVisit[]>();
  for (const v of visits) byDay.set(v.day, [...(byDay.get(v.day) ?? []), v]);
  const days: WorkedDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => {
      const rate = rateOn(rates, day);
      const cents = !rate ? 0 : rate.payType === "day_rate" ? (rate.dayRateCents ?? 0) : list.reduce((s, v) => s + visitShare(rate, v), 0);
      return { day, visits: list, rate, cents };
    });
  return {
    days,
    daysWorked: days.length,
    totalCents: days.reduce((s, d) => s + d.cents, 0),
    // days worked before any rate was set: they earn nothing until one is
    daysWithoutRate: days.filter((d) => !d.rate).map((d) => d.day),
  };
}

export const describeRate = (r: PayRate, money: (cents: number) => string) =>
  r.payType === "day_rate" ? `${money(r.dayRateCents ?? 0)} a day` : `${(r.percentBp ?? 0) / 100}% of each cleaning`;

// Stock math: status colors, how long stock lasts, what to reorder, and what
// a count or a vehicle restock means. Pure functions, easy to test. Days are
// "YYYY-MM-DD".

export type StockStatus = "out" | "low" | "ok";

// Out at zero; low at or under the reorder point.
export function stockStatus(onHand: number, reorderPoint: number): StockStatus {
  if (onHand <= 0) return "out";
  if (reorderPoint > 0 && onHand <= reorderPoint) return "low";
  return "ok";
}
export const statusStyle: Record<StockStatus, { label: string; variant: "destructive" | "warning" | "success" }> = {
  out: { label: "Out", variant: "destructive" },
  low: { label: "Low", variant: "warning" },
  ok: { label: "OK", variant: "success" },
};

// How many days what's on hand lasts at the recent rate; null when nothing's
// being used.
export function daysLeft(onHand: number, perDay: number): number | null {
  if (perDay <= 0) return null;
  return Math.max(0, Math.floor(onHand / perDay));
}

export type ReorderInput = {
  totalOnHand: number; // everywhere: storage, vehicles, sites
  storageOnHand: number;
  reorderPoint: number;
  reorderQuantity: number;
  perDay: number; // recent average use
};

// Whether to buy more, and how much: when storage is at or under its reorder
// point, or everything on hand runs out within the lead time. Buys enough to
// cover `coverDays` of use, and at least the usual reorder quantity.
export function reorder(i: ReorderInput, { leadDays = 7, coverDays = 30 } = {}) {
  const left = daysLeft(i.totalOnHand, i.perDay);
  const reasons: string[] = [];
  if (i.reorderPoint > 0 && i.storageOnHand <= i.reorderPoint) reasons.push(i.storageOnHand <= 0 ? "out in storage" : "low in storage");
  if (left !== null && left < leadDays) reasons.push(`runs out in about ${left} ${left === 1 ? "day" : "days"}`);
  if (!reasons.length) return null;
  const forUse = Math.ceil(i.perDay * coverDays) - i.totalOnHand;
  return { quantity: Math.max(i.reorderQuantity, forUse, 1), reasons, daysLeft: left };
}

// A count (or a vehicle restock) compares what should be there with what is:
// a supply that's short was used; a reusable item that's short was lost or
// worn out; anything extra was found. A vehicle is then loaded back up to
// its par.
export function countResult(kind: "supply" | "reusable", expected: number, counted: number, par = 0) {
  const short = Math.max(0, expected - counted);
  return {
    used: kind === "supply" ? short : 0,
    writtenOff: kind === "reusable" ? short : 0,
    found: Math.max(0, counted - expected),
    toLoad: Math.max(0, par - counted),
  };
}

const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
// calendar months between two days, with a fraction for the leftover days
const months = (from: string, to: string) => {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 30;
};

// When equipment is next due for routine service (from its last service, or
// when it was bought).
export function serviceDue(a: { lastServicedOn: string | null; purchasedOn: string }, intervalDays: number | null, today: string) {
  if (!intervalDays) return null;
  const dueOn = addDays(a.lastServicedOn ?? a.purchasedOn, intervalDays);
  return { dueOn, overdue: dueOn < today, soon: dueOn >= today && dueOn <= addDays(today, 14) };
}

// What equipment is still worth on the books: straight-line over its useful
// life, never below zero. Without a useful life, the purchase cost.
export function bookValue(costCents: number, purchasedOn: string, usefulLifeMonths: number | null, today: string) {
  if (!usefulLifeMonths) return costCents;
  const used = Math.min(1, Math.max(0, months(purchasedOn, today) / usefulLifeMonths));
  return Math.round(costCents * (1 - used));
}

// What a quote says, as one structured document (stored as JSON): the same
// building blocks as the estimates MaidCare has always sent. Pure functions
// for checking it, adding it up and fingerprinting it; shared by the editor,
// the server and the customer's page.

import { translator, type Tr } from "@/lib/i18n/tr";
export type QuoteOption = {
  id: string;
  name: string; // "Option 1: Deep Clean First"
  description: string; // "Deep clean of all 4 floors, including the 4th floor"
  priceCents: number; // the first visit
  recurringCents: number | null; // the visits after, when they differ by option
};
export type QuoteAddOn = {
  id: string;
  name: string; // "Closet organization"
  description: string;
  priceCents: number;
  // optional: the customer can pick it when accepting (added to the first
  // invoice); on_request: listed with its price, added to a visit when asked
  kind: "optional" | "on_request";
};
export type RecurringLine = { name: string; description: string; when: string; priceCents: number };
export type QuoteContent = {
  title: string; // the blue band: "First-time deep clean + organization"
  intro: string; // "Pick one of the two options below…"
  areas: string[]; // "Floors 1–3 (every visit): 2 bedrooms…"
  options: QuoteOption[];
  // what's included: one column is a checklist; two or more compare levels
  // ("Standard" vs "Deep clean")
  included: { columns: string[]; tasks: { label: string; marks: boolean[] }[] };
  addOns: QuoteAddOn[];
  recurringTitle: string; // "Recurring cleaning options"
  recurringIntro: string; // "Each month: a standard cleaning for 3 weeks…"
  recurring: RecurringLine[];
  notes: string[]; // the italic lines: "Prices are per visit."
  // sales tax added to the total, in hundredths of a percent (600 = 6%); 0 for none
  taxBp: number;
};

export const MAX_CENTS = 10_000_000; // $100,000, as invoices

export const emptyContent = (): QuoteContent => ({
  title: "",
  intro: "",
  areas: [],
  options: [{ id: "o1", name: "", description: "", priceCents: 0, recurringCents: null }],
  included: { columns: [""], tasks: [] },
  addOns: [],
  recurringTitle: "Recurring cleaning options",
  recurringIntro: "",
  recurring: [],
  notes: [],
  taxBp: 0,
});

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const cents = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_CENTS ? v : null);
const lines = (v: unknown, max: number, each: number) => (Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : []);

// Checks and cleans a document from the editor (or the database). Returns
// the cleaned content and what's wrong, if anything.
// Errors are in the language of tr (English by default).
export function checkContent(raw: unknown, tr: Tr = translator("en-US")): { content: QuoteContent; errors: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const title = str(r.title, 120);
  if (!title) errors.push(tr("Give the quote a title, like “First-time deep clean”."));
  const optionsRaw = Array.isArray(r.options) ? r.options.slice(0, 6) : [];
  const ids = new Set<string>();
  const options: QuoteOption[] = optionsRaw.map((o, i) => {
    const x = (o ?? {}) as Record<string, unknown>;
    let id = str(x.id, 20) || `o${i + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);
    const priceCents = cents(x.priceCents);
    const name = str(x.name, 100);
    if (!name) errors.push(tr("Option {n} needs a name.", { n: i + 1 }));
    if (priceCents === null || priceCents === 0) errors.push(tr("Option {n} needs a price.", { n: i + 1 }));
    const recurring = x.recurringCents == null || x.recurringCents === "" ? null : cents(x.recurringCents);
    if (x.recurringCents != null && x.recurringCents !== "" && recurring === null) errors.push(tr("Option {n} has a recurring price that doesn't look right.", { n: i + 1 }));
    return { id, name, description: str(x.description, 300), priceCents: priceCents ?? 0, recurringCents: recurring };
  });
  if (!options.length) errors.push(tr("Add at least one option with a price."));

  const inc = (r.included && typeof r.included === "object" ? r.included : {}) as Record<string, unknown>;
  const columns = (Array.isArray(inc.columns) ? inc.columns : [""]).slice(0, 4).map((c) => str(c, 40));
  const tasks = (Array.isArray(inc.tasks) ? inc.tasks : [])
    .slice(0, 60)
    .map((t) => {
      const x = (t ?? {}) as Record<string, unknown>;
      const marks = columns.map((_, i) => Array.isArray(x.marks) ? Boolean(x.marks[i]) : true);
      return { label: str(x.label, 120), marks };
    })
    .filter((t) => t.label);

  const addIds = new Set<string>(ids);
  const addOns: QuoteAddOn[] = (Array.isArray(r.addOns) ? r.addOns : []).slice(0, 10).map((a, i) => {
    const x = (a ?? {}) as Record<string, unknown>;
    let id = str(x.id, 20) || `a${i + 1}`;
    while (addIds.has(id)) id = `${id}x`;
    addIds.add(id);
    const priceCents = cents(x.priceCents);
    const name = str(x.name, 100);
    if (!name) errors.push(tr("Add-on {n} needs a name.", { n: i + 1 }));
    if (priceCents === null) errors.push(tr("Add-on {n} needs a price.", { n: i + 1 }));
    return { id, name, description: str(x.description, 300), priceCents: priceCents ?? 0, kind: x.kind === "on_request" ? "on_request" : "optional" };
  });

  const recurring: RecurringLine[] = (Array.isArray(r.recurring) ? r.recurring : []).slice(0, 8).map((l, i) => {
    const x = (l ?? {}) as Record<string, unknown>;
    const priceCents = cents(x.priceCents);
    const name = str(x.name, 100);
    if (!name) errors.push(tr("Recurring line {n} needs a name.", { n: i + 1 }));
    if (priceCents === null || priceCents === 0) errors.push(tr("Recurring line {n} needs a price.", { n: i + 1 }));
    return { name, description: str(x.description, 200), when: str(x.when, 60), priceCents: priceCents ?? 0 };
  });

  return {
    content: {
      title,
      intro: str(r.intro, 400),
      areas: lines(r.areas, 12, 300),
      options,
      included: { columns: columns.length ? columns : [""], tasks },
      addOns,
      recurringTitle: str(r.recurringTitle, 80) || "Recurring cleaning options",
      recurringIntro: str(r.recurringIntro, 300),
      recurring,
      notes: lines(r.notes, 8, 300),
      taxBp: typeof r.taxBp === "number" && Number.isInteger(r.taxBp) && r.taxBp >= 0 && r.taxBp <= 2000 ? r.taxBp : 0,
    },
    errors,
  };
}

// What the customer pays at the first visit for an option and the optional
// add-ons they picked; null when the choice isn't on this quote.
export function totalFor(content: QuoteContent, optionId: string, addOnIds: string[]) {
  const option = content.options.find((o) => o.id === optionId);
  if (!option) return null;
  const picked = [...new Set(addOnIds)].map((id) => content.addOns.find((a) => a.id === id && a.kind === "optional"));
  if (picked.some((a) => !a)) return null;
  const addOns = picked as QuoteAddOn[];
  const subtotalCents = option.priceCents + addOns.reduce((s, a) => s + a.priceCents, 0);
  const taxCents = Math.round((subtotalCents * content.taxBp) / 10000);
  return { option, addOns, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

// The lowest and highest first-visit total a quote could come to (for lists
// and reports before the customer chooses).
export function priceRange(content: QuoteContent) {
  const prices = content.options.map((o) => o.priceCents);
  return { low: Math.min(...prices), high: Math.max(...prices) };
}

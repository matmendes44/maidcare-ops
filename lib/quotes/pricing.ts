// The price list and the math that turns a home's details into an estimate.
// Pure functions, easy to test. Money is in cents.
import { phrase, translator, type Tr, type Vars } from "@/lib/i18n/tr";
import type { QuoteContent } from "./content";
import { isCleaningIcon, type CleaningIcon } from "./icons";

export type Extra = {
  id: string;
  name: string;
  icon: CleaningIcon;
  priceCents: number;
  perUnit: boolean; // per room, else a flat fee
  unit: string; // "room"…, for per-unit extras
  minUnits: number;
};
// Standard, Deep clean and Move-in/out. Standard is the base price; the
// others are a flat upgrade on top.
export type ServiceLevel = { id: "standard" | "deep" | "moveout"; name: string; upgradeCents: number; tasks: string[] };

export type PriceList = {
  bedrooms: { bedrooms: number; cents: number }[];
  bathroomCents: number;
  minBathrooms: number;
  maxBathrooms: number;
  halfBathCents: number;
  // added to the bedroom price by the home's size (not shown separately)
  sqft: { upTo: number; cents: number }[];
  extras: Extra[];
  levels: ServiceLevel[];
  // percent off the recurring standard cleanings (never the first visit)
  frequencies: { id: string; name: string; everyLabel: string; discountPct: number }[];
};

const standardTasks = ["Dusting of reachable surfaces", "Kitchen: counters, sink, stovetop and appliance exteriors", "Bathrooms: toilets, tubs and showers, sinks and mirrors", "Vacuuming and mopping of all floors", "Trash emptied"];
const deepTasks = [...standardTasks, "Wipe-down of all surfaces", "Baseboards", "Light fixtures and ceiling fans", "Window sills", "Vents", "Inside the oven"];

// MaidCare's prices (October 2026). Edited on the Price list page afterwards.
export const defaultPriceList: PriceList = {
  bedrooms: [
    { bedrooms: 1, cents: 12000 },
    { bedrooms: 2, cents: 15500 },
    { bedrooms: 3, cents: 21000 },
    { bedrooms: 4, cents: 23500 },
    { bedrooms: 5, cents: 28000 },
    { bedrooms: 6, cents: 33500 },
  ],
  bathroomCents: 3000,
  minBathrooms: 1,
  maxBathrooms: 10,
  halfBathCents: 1000,
  sqft: [
    { upTo: 1500, cents: 0 },
    { upTo: 2000, cents: 3000 },
    { upTo: 2500, cents: 8000 },
    { upTo: 3500, cents: 10000 },
    { upTo: 4500, cents: 12000 },
    { upTo: 5500, cents: 14000 },
    { upTo: 6000, cents: 16000 },
  ],
  extras: [
    { id: "rooms", name: "Extra rooms", icon: "door", priceCents: 2500, perUnit: true, unit: "room", minUnits: 1 },
    { id: "cabinets", name: "Inside cabinets", icon: "cabinet", priceCents: 3000, perUnit: false, unit: "", minUnits: 1 },
    { id: "fridge", name: "Inside the fridge", icon: "fridge", priceCents: 4500, perUnit: false, unit: "", minUnits: 1 },
    { id: "oven", name: "Inside the oven", icon: "oven", priceCents: 4500, perUnit: false, unit: "", minUnits: 1 },
    { id: "laundry", name: "Laundry (1 load)", icon: "laundry", priceCents: 3000, perUnit: false, unit: "", minUnits: 1 },
  ],
  levels: [
    { id: "standard", name: "Standard cleaning", upgradeCents: 0, tasks: standardTasks },
    { id: "deep", name: "Deep clean", upgradeCents: 17500, tasks: deepTasks },
    { id: "moveout", name: "Move-in / move-out", upgradeCents: 21000, tasks: [...deepTasks, "Inside cabinets and drawers", "Inside the fridge", "Inside closets"] },
  ],
  frequencies: [
    { id: "weekly", name: "Weekly", everyLabel: "Every week", discountPct: 20 },
    { id: "every3", name: "Every 3 weeks", everyLabel: "Every 3 weeks", discountPct: 15 },
    { id: "biweekly", name: "Every 2 weeks", everyLabel: "Every 2 weeks", discountPct: 10 },
    { id: "monthly", name: "Monthly", everyLabel: "Every month", discountPct: 5 },
  ],
};

export type HomeInput = { bedrooms: number; bathrooms: number; halfBaths: number; sqft: number | null };
export type Line = { label: string; cents: number };

export const fmtCents = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
export const sum = (lines: Line[]) => lines.reduce((s, l) => s + l.cents, 0);
export const discounted = (cents: number, pct: number) => Math.round((cents * (100 - pct)) / 100);

// The size ranges as people read them: "Up to 1,500 sq ft", "1,501–2,000 sq ft"…
// (in the language of tr; English by default)
export function sqftRanges(list: PriceList, tr: Tr = translator("en-US")) {
  const n = (x: number) => x.toLocaleString("en-US");
  return list.sqft.map((t, i) => ({
    upTo: t.upTo,
    cents: t.cents,
    label: i === 0 ? tr("Up to {n} sq ft", { n: n(t.upTo) }) : tr("{from}–{to} sq ft", { from: n(list.sqft[i - 1].upTo + 1), to: n(t.upTo) }),
  }));
}

// A standard clean of this home, line by line. The size surcharge is part of
// the bedroom line, so the estimate doesn't list square footage.
// Errors are English with {placeholders} filled from errorVars (shown through tr()).
export function basePrice(list: PriceList, h: HomeInput): { lines: Line[]; error?: string; errorVars?: Vars } {
  const b = list.bedrooms.find((x) => x.bedrooms === h.bedrooms);
  if (!b) return { lines: [], error: phrase("Pick the number of bedrooms.") };
  let size = 0;
  if (h.sqft) {
    const tier = list.sqft.find((t) => h.sqft! <= t.upTo);
    if (!tier) return { lines: [], error: phrase("Homes over {sqft} sq ft need a custom estimate."), errorVars: { sqft: list.sqft.at(-1)!.upTo.toLocaleString("en-US") } };
    size = tier.cents;
  }
  const baths = Math.min(list.maxBathrooms, Math.max(list.minBathrooms, h.bathrooms));
  const lines: Line[] = [
    { label: `${b.bedrooms} bedroom${b.bedrooms === 1 ? "" : "s"}`, cents: b.cents + size },
    { label: `${baths} bathroom${baths === 1 ? "" : "s"}`, cents: baths * list.bathroomCents },
  ];
  if (h.halfBaths > 0) lines.push({ label: `${h.halfBaths} half bath${h.halfBaths === 1 ? "" : "s"}`, cents: h.halfBaths * list.halfBathCents });
  return { lines };
}

export function extraLine(list: PriceList, id: string, units: number): Line | null {
  const e = list.extras.find((x) => x.id === id);
  if (!e) return null;
  if (!e.perUnit) return { label: e.name, cents: e.priceCents };
  const n = Math.max(e.minUnits, units);
  return { label: `${e.name} × ${n}`, cents: n * e.priceCents };
}

// ---- type of cleaning ----
// Which cleanings can go together, and the recurring choices they allow:
// - Standard alone: the first visit, optionally recurring (any frequency)
// - Deep clean alone: one-time, or the deep clean repeated monthly
// - Deep + Standard: deep first, then standard cleanings weekly, every 2
//   weeks or monthly (required)
// - Move-in/out alone: one-time
// - Move-in/out + Standard (never with deep): move-in/out first, then
//   standard cleanings at any frequency (required)
export type Cleaning = { levels: string[]; frequencyId: string | null };
export const DEEP_PLAN_FREQUENCIES = ["weekly", "biweekly", "monthly"];
export const DEEP_ALONE_FREQUENCIES = ["monthly"];

export function firstService(levels: string[]): "moveout" | "deep" | "standard" | null {
  if (levels.includes("moveout")) return "moveout";
  if (levels.includes("deep")) return "deep";
  if (levels.includes("standard")) return "standard";
  return null;
}

// Standard cleanings after a deep or move-in/out clean always repeat, so how
// often has to be chosen.
export function frequencyRequired(levels: string[]) {
  const first = firstService(levels);
  return (first === "deep" || first === "moveout") && levels.includes("standard");
}

// The recurring choices offered for a selection (empty: one-time only).
export function allowedFrequencies(list: PriceList, levels: string[]) {
  const first = firstService(levels);
  const standard = levels.includes("standard");
  if (!first) return [];
  if (first === "deep") return list.frequencies.filter((f) => (standard ? DEEP_PLAN_FREQUENCIES : DEEP_ALONE_FREQUENCIES).includes(f.id));
  if (first === "moveout") return standard ? list.frequencies : [];
  return list.frequencies;
}

export function cleaningProblem(list: PriceList, c: Cleaning): string | null {
  const first = firstService(c.levels);
  if (!first) return phrase("Pick the type of cleaning.");
  if (c.levels.includes("moveout") && c.levels.includes("deep")) return phrase("Move-in / move-out can't be combined with a deep clean.");
  if (c.frequencyId && !allowedFrequencies(list, c.levels).some((f) => f.id === c.frequencyId)) return phrase("That recurring choice isn't available for this type of cleaning.");
  if (frequencyRequired(c.levels) && !c.frequencyId)
    return first === "deep"
      ? phrase("Pick weekly, every 2 weeks or monthly for the standard cleanings after the deep clean.")
      : phrase("Pick how often the standard cleanings repeat after the move-in / move-out clean.");
  return null;
}

export type EstimateInput = HomeInput & Cleaning & { extras: { id: string; units: number }[] };

// The estimate document: the first visit (with its price breakdown in the
// description), what it includes, and the recurring standard cleanings.
export function buildEstimate(list: PriceList, input: EstimateInput): { content: QuoteContent; error?: string; errorVars?: Vars } {
  const empty: QuoteContent = { title: "", intro: "", areas: [], options: [], included: { columns: [""], tasks: [] }, addOns: [], recurringTitle: "", recurringIntro: "", recurring: [], notes: [], taxBp: 0 };
  const problem = cleaningProblem(list, input);
  if (problem) return { content: empty, error: problem };
  const base = basePrice(list, input);
  if (base.error) return { content: empty, error: base.error, errorVars: base.errorVars };
  const level = list.levels.find((l) => l.id === firstService(input.levels));
  if (!level) return { content: empty, error: phrase("Pick the type of cleaning.") };

  const extras = input.extras.map((e) => extraLine(list, e.id, e.units)).filter((l): l is Line => l !== null);
  const lines = [...base.lines, ...(level.upgradeCents ? [{ label: `${level.name} upgrade`, cents: level.upgradeCents }] : []), ...extras];
  const frequency = list.frequencies.find((f) => f.id === input.frequencyId) ?? null;
  // recurring visits are standard cleanings of the same home, or the deep
  // clean itself when it's on its own; never the extras; discounted
  const deepRepeats = level.id === "deep" && !input.levels.includes("standard");
  const recurringName = deepRepeats ? level.name : list.levels.find((l) => l.id === "standard")?.name ?? "Standard cleaning";
  const recurringCents = frequency ? discounted(sum(base.lines) + (deepRepeats ? level.upgradeCents : 0), frequency.discountPct) : null;
  const sameService = level.id === "standard" || deepRepeats;

  const baths = Math.min(list.maxBathrooms, Math.max(list.minBathrooms, input.bathrooms));
  const home = [
    `${input.bedrooms} bedroom${input.bedrooms === 1 ? "" : "s"}`,
    `${baths} bathroom${baths === 1 ? "" : "s"}`,
    input.halfBaths ? `${input.halfBaths} half bath${input.halfBaths === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const extraNames = input.extras.map((e) => list.extras.find((x) => x.id === e.id)?.name).filter(Boolean) as string[];

  // with standard cleanings after, the deep or move-in/out clean is the first visit
  const firstVisitNames: Record<string, string> = { deep: "Deep Clean", moveout: "Move In / Move Out" };
  const optionName = level.id !== "standard" && input.levels.includes("standard") ? `First Visit: ${firstVisitNames[level.id]}` : level.name;

  const content: QuoteContent = {
    title: optionName,
    intro: "",
    areas: [`Your home: ${home}.`],
    options: [
      {
        id: level.id,
        name: optionName,
        description: lines.map((l) => `${l.label} ${fmtCents(l.cents)}`).join(" · "),
        priceCents: sum(lines),
        recurringCents: sameService ? recurringCents : null,
      },
    ],
    included: { columns: [""], tasks: [...level.tasks, ...extraNames].map((label) => ({ label, marks: [true] })) },
    addOns: [],
    recurringTitle: "Recurring cleaning",
    recurringIntro: frequency && recurringCents ? `After your first visit, ${deepRepeats ? "the deep clean repeats" : "standard cleanings continue"} ${frequency.everyLabel.toLowerCase()} at ${fmtCents(recurringCents)}.` : "",
    recurring:
      frequency && recurringCents
        ? [{ name: recurringName, description: `${frequency.discountPct}% off every visit after the first`, when: frequency.everyLabel, priceCents: recurringCents }]
        : [],
    notes: ["Prices are per visit.", ...(frequency ? ["The first visit is always full price; the recurring discount starts with the second visit."] : [])],
    taxBp: 0,
  };
  return { content };
}

// Checks a price list from the Price list page (or the database). Anything
// missing comes from the defaults.
export function checkPriceList(raw: unknown): { list: PriceList; errors: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const d = defaultPriceList;
  const cents = (v: unknown, what: string) => {
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000) return v;
    errors.push(`${what} needs a price.`);
    return 0;
  };
  const whole = (v: unknown, what: string, min = 0, max = 100_000) => {
    if (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max) return v;
    errors.push(`${what} must be a whole number.`);
    return min;
  };
  const text = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const arr = <T,>(v: unknown, fallback: T[]) => (Array.isArray(v) ? (v as T[]) : fallback);

  const bedrooms = arr<Record<string, unknown>>(r.bedrooms, d.bedrooms as never)
    .slice(0, 12)
    .map((b, i) => ({ bedrooms: whole(b.bedrooms, `Bedroom row ${i + 1}`, 1, 20), cents: cents(b.cents, `${b.bedrooms} bedrooms`) }))
    .sort((a, b) => a.bedrooms - b.bedrooms);
  if (new Set(bedrooms.map((b) => b.bedrooms)).size !== bedrooms.length) errors.push("Each bedroom count can only be listed once.");
  if (!bedrooms.length) errors.push("List at least one bedroom price.");
  const sqft = arr<Record<string, unknown>>(r.sqft, d.sqft as never)
    .slice(0, 15)
    .map((s, i) => ({ upTo: whole(s.upTo, `Square footage row ${i + 1}`, 1, 100_000), cents: cents(s.cents, `Square footage row ${i + 1}`) }))
    .sort((a, b) => a.upTo - b.upTo);
  const ids = new Set<string>();
  const extras = arr<Record<string, unknown>>(r.extras, d.extras as never)
    .slice(0, 40)
    .map((e, i) => {
      let id = text(e.id, 30).replace(/[^\w-]/g, "") || `e${i + 1}`;
      while (ids.has(id)) id = `${id}x`;
      ids.add(id);
      const name = text(e.name) || `Extra ${i + 1}`;
      return {
        id,
        name,
        icon: isCleaningIcon(e.icon) ? e.icon : ("sparkles" as const),
        priceCents: cents(e.priceCents, name),
        perUnit: Boolean(e.perUnit),
        unit: text(e.unit, 30) || "room",
        minUnits: whole(e.minUnits ?? 1, `${name} minimum`, 1, 50),
      };
    });
  // the three types of cleaning are fixed; their names, prices and tasks can change
  const levelsRaw = arr<Record<string, unknown>>(r.levels, []);
  const levels = d.levels.map((def) => {
    const l = levelsRaw.find((x) => x.id === def.id) ?? (def as unknown as Record<string, unknown>);
    return {
      id: def.id,
      name: text(l.name) || def.name,
      upgradeCents: def.id === "standard" ? 0 : cents(l.upgradeCents, text(l.name) || def.name),
      tasks: arr<unknown>(l.tasks, def.tasks).map((t) => text(t, 120)).filter(Boolean).slice(0, 40),
    };
  });
  const frequencies = d.frequencies.map((def) => {
    const f = arr<Record<string, unknown>>(r.frequencies, []).find((x) => x.id === def.id) ?? (def as unknown as Record<string, unknown>);
    return { ...def, discountPct: whole(f.discountPct, `${def.name} discount`, 0, 90) };
  });
  const minBathrooms = whole(r.minBathrooms ?? d.minBathrooms, "Minimum bathrooms", 0, 20);
  const maxBathrooms = whole(r.maxBathrooms ?? d.maxBathrooms, "Most bathrooms", 1, 30);
  if (maxBathrooms < minBathrooms) errors.push("The most bathrooms can't be less than the minimum.");
  return {
    list: {
      bedrooms,
      bathroomCents: cents(r.bathroomCents ?? d.bathroomCents, "Bathrooms"),
      minBathrooms,
      maxBathrooms,
      halfBathCents: cents(r.halfBathCents ?? d.halfBathCents, "Half baths"),
      sqft,
      extras,
      levels,
      frequencies,
    },
    errors,
  };
}

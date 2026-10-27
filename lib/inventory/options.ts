// The fixed lists behind inventory. The database checks the same values
// (drizzle/0015_inventory.sql); add to both together.

// How an item is tracked:
// - supply: used up (refills, paper, chemicals). Counted by unit; what's
//   gone at a count or restock was used.
// - reusable: lasts a while but wears out or goes missing (towels, mops,
//   buckets). Counted by unit; what's gone at a count was lost or worn out.
// - equipment: each unit tracked on its own with an asset tag, a location,
//   a status and the expense it was bought with (vacuums, steamers).
export const itemKinds = {
  supply: { label: "Supply", hint: "Used up: refills, paper towels, chemicals" },
  reusable: { label: "Reusable", hint: "Wears out: towels, mops, buckets, spray bottles" },
  equipment: { label: "Equipment", hint: "Tracked one by one: vacuums, steamers" },
} as const;
export type ItemKind = keyof typeof itemKinds;
export const itemKindKeys = Object.keys(itemKinds) as ItemKind[];

export const itemCategories = {
  chemicals: "Cleaning chemicals",
  paper: "Paper goods",
  cloths: "Cloths & towels",
  dusters: "Dusters & refills",
  liners: "Trash liners & bags",
  ppe: "Gloves & PPE",
  tools: "Mops, brooms & tools",
  bottles: "Bottles & caddies",
  vacuums: "Vacuums & parts",
  machines: "Steamers & machines",
  other: "Other",
} as const;
export type ItemCategory = keyof typeof itemCategories;
export const itemCategoryKeys = Object.keys(itemCategories) as ItemCategory[];

export const units = ["each", "bottle", "gallon", "roll", "pack", "box", "case", "pair", "bag"] as const;
export type Unit = (typeof units)[number];
export const plural = (n: number, unit: string) =>
  unit === "each" ? `${n}` : `${n} ${n === 1 ? unit : unit === "box" ? "boxes" : unit === "pair" ? "pairs" : `${unit}s`}`;

export const locationKinds = { storage: "Storage", vehicle: "Vehicle", site: "Client site" } as const;
export type LocationKind = keyof typeof locationKinds;

export const assetStatuses = {
  in_service: { label: "In service", variant: "success" },
  needs_repair: { label: "Needs repair", variant: "warning" },
  in_repair: { label: "In repair", variant: "info" },
  retired: { label: "Retired", variant: "muted" },
  lost: { label: "Lost", variant: "destructive" },
} as const;
export type AssetStatus = keyof typeof assetStatuses;
export const assetStatusKeys = Object.keys(assetStatuses) as AssetStatus[];

export const reportKinds = {
  low: "Running low",
  out: "Out",
  broken: "Broken",
  missing: "Missing",
  other: "Something else",
} as const;
export type ReportKind = keyof typeof reportKinds;
export const reportKindKeys = Object.keys(reportKinds) as ReportKind[];

export const movementKinds = {
  purchase: "Received",
  transfer: "Moved",
  use: "Used",
  adjust: "Count correction",
  write_off: "Written off",
} as const;
export type MovementKind = keyof typeof movementKinds;

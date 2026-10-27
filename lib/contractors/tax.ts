// 1099-NEC rules for contractors. Pure functions, so the rules are tested and
// in one place. These follow IRS guidance as of 2026; have your accountant
// confirm the threshold each year.

// Who needs a 1099-NEC: anyone (not a corporation) paid at least this much
// in the year for their work. $600 through 2025; $2,000 from 2026 (later
// years are adjusted for inflation: add them here when announced).
const THRESHOLDS: [year: number, cents: number][] = [
  [2026, 200_000],
  [0, 60_000],
];
export const thresholdCents = (year: number) => THRESHOLDS.find(([from]) => year >= from)![1];

// Payments by card or through PayPal/Venmo-style apps are reported by the
// payment company on a 1099-K, so they're left off the 1099-NEC. Cash,
// checks, bank transfers and Zelle go on it.
export const NEC_METHODS = ["cash", "check", "bank_transfer", "zelle", "other"] as const;
export const isNecReportable = (method: string) => (NEC_METHODS as readonly string[]).includes(method);

export const taxClassifications = {
  individual: "Individual / sole proprietor",
  llc_single: "Single-member LLC",
  partnership: "Partnership",
  llc_partnership: "LLC taxed as a partnership",
  c_corp: "C corporation",
  s_corp: "S corporation",
  llc_c_corp: "LLC taxed as a C corporation",
  llc_s_corp: "LLC taxed as an S corporation",
  other: "Other",
} as const;
export type TaxClassification = keyof typeof taxClassifications;
// corporations don't get a 1099-NEC (except attorneys, which isn't us)
export const isCorporation = (c: string | null) => c === "c_corp" || c === "s_corp" || c === "llc_c_corp" || c === "llc_s_corp";

// Jan 31 of the next year, or the next weekday when it's a weekend.
export function dueDate(taxYear: number) {
  const d = new Date(Date.UTC(taxYear + 1, 0, 31));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Checks a typed SSN or EIN (digits only). Returns an error, or null.
export function tinProblem(type: "ssn" | "ein", digits: string): string | null {
  if (!/^\d{9}$/.test(digits)) return "A tax ID has 9 digits.";
  if (type === "ssn") {
    const [area, group, serial] = [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5)];
    if (area === "000" || area === "666" || area[0] === "9" || group === "00" || serial === "0000") return "That isn't a valid Social Security number.";
  } else if (digits.startsWith("00") || ["07", "08", "09", "17", "18", "19", "28", "29", "49", "69", "70", "78", "79", "89", "96", "97"].includes(digits.slice(0, 2))) {
    return "That isn't a valid EIN.";
  }
  return null;
}

export const maskTin = (type: string | null, last4: string | null) => (!last4 ? null : type === "ein" ? `••-•••${last4}` : `•••-••-${last4}`);
export const formatTin = (type: string | null, digits: string) => (type === "ein" ? `${digits.slice(0, 2)}-${digits.slice(2)}` : `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`);

export type YearStatus = {
  state: "needs_1099" | "filed" | "below_threshold" | "exempt";
  // what's missing before a 1099 can be filed
  problems: string[];
  // a filed 1099 whose amount no longer matches the payments
  changedSinceFiled: boolean;
};

export function yearStatus(
  taxYear: number,
  c: {
    reportableCents: number;
    taxClassification: string | null;
    tinLast4: string | null;
    w9ReceivedOn: string | null;
    hasAddress: boolean;
    filed: { reportedCents: number } | null;
  },
): YearStatus {
  const problems: string[] = [];
  if (!c.w9ReceivedOn) problems.push("No W-9 on file");
  if (!c.tinLast4) problems.push("No tax ID: the IRS requires 24% backup withholding from payments to people who don't give one");
  if (!c.hasAddress) problems.push("No mailing address");
  if (isCorporation(c.taxClassification)) return { state: "exempt", problems: [], changedSinceFiled: false };
  if (c.filed) return { state: "filed", problems: [], changedSinceFiled: c.filed.reportedCents !== c.reportableCents };
  if (c.reportableCents < thresholdCents(taxYear)) return { state: "below_threshold", problems, changedSinceFiled: false };
  return { state: "needs_1099", problems, changedSinceFiled: false };
}

// Turning what's typed into an invoice line into exact amounts. Shared by the
// form (its live total) and the server (what's sent to Stripe), so the total
// shown while typing is the total that's billed.

// Upper bounds: far above any real cleaning invoice, and well inside what
// Stripe accepts and the database stores.
export const MAX_UNIT_CENTS = 10_000_000; // $100,000.00
export const MAX_TOTAL_CENTS = 10_000_000; // $100,000.00
export const MAX_QUANTITY = 999;

// A typed price in whole cents: "175", "$1,234.50", "19.9", ".5", "-20" (a
// discount). Parsed from the digits, never through floating point; null for
// anything else, including more than two decimal places.
export function parseCents(raw: string): number | null {
  const s = raw.replace(/[$,\s]/g, "");
  const m = /^(-)?(\d{0,9})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const cents = Number(m[2] || "0") * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] && cents ? -cents : cents;
}

// A typed quantity: a whole number from 1 to MAX_QUANTITY, digits only.
export function parseQuantity(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_QUANTITY ? n : null;
}

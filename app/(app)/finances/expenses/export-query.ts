import type { ExpenseFilters } from "./data";

// The list's filters as a query string (without paging), for links that keep
// them: exports, sorting, pages.
export function exportQuery(f: Partial<ExpenseFilters>, extra: Record<string, string | number | null> = {}) {
  const qs = new URLSearchParams();
  const all: Record<string, string | number | null | undefined> = {
    q: f.q,
    category: f.category,
    method: f.method,
    vendor: f.vendor,
    from: f.from,
    to: f.to,
    recurring: f.recurring,
    receipt: f.receipt,
    ...extra,
  };
  for (const [k, v] of Object.entries(all)) if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  return qs.toString();
}

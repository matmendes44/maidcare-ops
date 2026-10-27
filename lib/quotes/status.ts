// Where a quote stands, and whether someone should follow up. Pure
// functions; days are "YYYY-MM-DD", times ISO strings.
import { plural, translator, type Tr } from "@/lib/i18n/tr";

export type QuoteState = "draft" | "sent" | "viewed" | "accepted" | "scheduled" | "declined" | "expired" | "withdrawn";

// (labels are English: shown through tr())
export const stateStyle: Record<QuoteState, { label: string; variant: "muted" | "info" | "warning" | "success" | "destructive" | "secondary" }> = {
  draft: { label: "Draft", variant: "muted" },
  sent: { label: "Sent", variant: "info" },
  viewed: { label: "Viewed", variant: "secondary" },
  accepted: { label: "Accepted: to schedule", variant: "warning" },
  scheduled: { label: "Accepted & scheduled", variant: "success" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "muted" },
  withdrawn: { label: "Withdrawn", variant: "muted" },
};

// Estimates are good for two weeks from the day they're first sent.
export const VALID_DAYS = 14;
export const validUntilFrom = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + VALID_DAYS * 86_400_000).toISOString().slice(0, 10);

type Q = { status: string; validUntil: string; firstViewedAt: string | null; appointmentId: number | null };

export function quoteState(q: Q, today: string): QuoteState {
  if (q.status === "accepted") return q.appointmentId ? "scheduled" : "accepted";
  if (q.status === "declined" || q.status === "withdrawn" || q.status === "draft") return q.status;
  if (q.validUntil < today) return "expired";
  return q.firstViewedAt ? "viewed" : "sent";
}

// Open quotes can still be accepted by the customer.
export const isOpen = (s: QuoteState) => s === "sent" || s === "viewed";

const DAY = 86_400_000;
const daysSince = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / DAY);
const daysUntil = (day: string, today: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

// Why someone should reach out about a quote now, if they should (in the
// language of tr; English by default).
export function followUp(q: Q & { sentAt: string | null; lastViewedAt: string | null }, today: string, now = Date.now(), tr: Tr = translator("en-US")): string | null {
  const s = quoteState(q, today);
  if (s === "accepted") return tr("Accepted: call to schedule the first visit");
  if (!isOpen(s)) return null;
  const left = daysUntil(q.validUntil, today);
  if (left <= 3) return left === 0 ? tr("Expires today") : plural(tr, left, "Expires in {n} day", "Expires in {n} days");
  if (s === "sent" && q.sentAt && daysSince(q.sentAt, now) >= 2) return tr("Not opened yet: check they got the link");
  if (s === "viewed" && q.lastViewedAt && daysSince(q.lastViewedAt, now) >= 3) return tr("Opened but no answer yet");
  return null;
}

// The Eastern calendar day ("YYYY-MM-DD") of a timestamp: 8 PM on Oct 18 in
// Baltimore is Oct 18, though it's already Oct 19 in UTC.
const eastern = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
export const localDay = (iso: string) => eastern.format(new Date(iso));

import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { stripe } from "@/lib/stripe";
import { syncInvoice } from "@/lib/stripe-invoices";
import type { MemorizedLine } from "./draft";
import { replaceMemorized } from "./memorize";
import type { Frequency } from "./schedule";

// One-time move from service plans to memorized invoices: each open plan
// becomes its customer's memorized invoice for that property, from their
// latest real (finalized: open or paid) invoice, as often as the plan says.
// Stripe is asked for that invoice (it has every invoice, even ones the app
// hasn't copied yet); nothing is created there, only read. Customers with no
// real invoice in the last 7 weeks aren't treated as recurring.

export const RECENT_DAYS = 49; // 7 weeks

const planFrequency: Record<string, Frequency | undefined> = { weekly: "weekly", biweekly: "biweekly", every_4_weeks: "every_4_weeks", monthly: "monthly" };

export type ImportRow = {
  planId: number;
  customerId: number;
  customerCode: string;
  name: string;
  customerStatus: string;
  propertyId: number;
  street: string;
  planFrequency: string;
  frequency: Frequency | null;
  // id: the app's copy (null until it's copied in, when this is saved)
  invoice: { id: number | null; number: string | null; status: string; day: string; totalCents: number; stripeInvoiceId: string } | null;
  lines: MemorizedLine[] | null;
  decision: "create" | "skip";
  reason: string;
  // something to look at before saving (still created)
  warning: string | null;
};

// The invoice's lines as Stripe has them, in the order they were added.
async function linesOf(stripeInvoiceId: string): Promise<MemorizedLine[]> {
  const items = await stripe().invoices.listLineItems(stripeInvoiceId, { limit: 100 });
  const withPos = items.data.map((l, i) => ({
    description: (l.description ?? "").trim() || "Cleaning service",
    cents: l.amount,
    // the app numbers its lines; otherwise Stripe lists the newest first
    position: (l.metadata as Stripe.Metadata | null)?.position != null ? Number((l.metadata as Stripe.Metadata).position) : items.data.length - i,
  }));
  return withPos.sort((a, b) => a.position - b.position).map(({ description, cents }) => ({ description, cents }));
}

const easternDay = (seconds: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(seconds * 1000));

// A customer's latest finalized (open or paid) invoice in Stripe, for that
// property when the invoice says which.
async function latestFromStripe(stripeCustomerId: string, propertyId: number): Promise<ImportRow["invoice"]> {
  const found: Stripe.Invoice[] = [];
  for (const status of ["paid", "open"] as const) {
    const page = await stripe().invoices.list({ customer: stripeCustomerId, status, limit: 20 });
    found.push(...page.data);
  }
  const mine = found
    .filter((inv) => !inv.metadata?.app_property_id || inv.metadata.app_property_id === String(propertyId))
    .map((inv) => ({ inv, at: inv.status_transitions?.finalized_at ?? inv.created }))
    .sort((a, b) => b.at - a.at)[0];
  if (!mine) return null;
  const [local] = (await db.execute(sql`select id from invoices where stripe_invoice_id = ${mine.inv.id}`)).rows as { id: number }[];
  return { id: local ? Number(local.id) : null, number: mine.inv.number ?? null, status: mine.inv.status ?? "open", day: easternDay(mine.at), totalCents: mine.inv.total, stripeInvoiceId: mine.inv.id! };
}

export async function importCandidates(today: string, { withLines = true } = {}): Promise<ImportRow[]> {
  const rows = (
    await db.execute(sql`
      select sp.id as plan_id, sp.frequency::text as plan_frequency,
             c.id as customer_id, c.customer_code, c.status::text as customer_status, c.stripe_customer_id,
             coalesce(nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.company_name, c.customer_code) as name,
             p.id as property_id, p.street,
             exists (select 1 from memorized_invoices m where m.customer_id = c.id and m.is_active
                       and coalesce(m.property_id, 0) in (0, p.id)) as has_memorized,
             inv.id as invoice_id, inv.number, inv.status::text as invoice_status, inv.total_cents, inv.stripe_invoice_id,
             to_char(inv.at at time zone 'America/New_York', 'YYYY-MM-DD') as invoice_day
        from service_plans sp
        join properties p on p.id = sp.property_id
        join customers c on c.id = p.customer_id
        left join lateral (
          select i.id, i.number, i.status, i.total_cents, i.stripe_invoice_id, coalesce(i.finalized_at, i.created_at) as at
            from invoices i
           where i.customer_id = c.id and i.status in ('open', 'paid')
             and (i.property_id = p.id or i.property_id is null)
           order by coalesce(i.finalized_at, i.created_at) desc limit 1
        ) inv on true
       where sp.end_date is null
       order by c.customer_code`)
  ).rows as {
    plan_id: number; plan_frequency: string; customer_id: number; customer_code: string; customer_status: string; stripe_customer_id: string | null; name: string; property_id: number; street: string;
    has_memorized: boolean; invoice_id: number | null; number: string | null; invoice_status: string | null; total_cents: number | null; stripe_invoice_id: string | null; invoice_day: string | null;
  }[];
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);

  const out: ImportRow[] = rows.map((r) => {
    const frequency = planFrequency[r.plan_frequency] ?? null;
    const invoice = r.invoice_id
      ? { id: Number(r.invoice_id), number: r.number, status: r.invoice_status!, day: r.invoice_day!, totalCents: Number(r.total_cents), stripeInvoiceId: r.stripe_invoice_id! }
      : null;
    const base = {
      planId: Number(r.plan_id),
      customerId: Number(r.customer_id),
      customerCode: r.customer_code,
      name: r.name,
      customerStatus: r.customer_status,
      propertyId: Number(r.property_id),
      street: r.street,
      planFrequency: r.plan_frequency,
      frequency,
      invoice,
      lines: null,
      warning: null,
    };
    const skip = (reason: string): ImportRow => ({ ...base, decision: "skip", reason });
    if (r.customer_status !== "active") return skip(`Customer is ${r.customer_status}`);
    if (r.has_memorized) return skip("Already has a recurring invoice");
    if (!frequency) return skip(r.plan_frequency === "one_time" ? "One-time plan" : `"${r.plan_frequency}" isn't a recurring frequency here`);
    return { ...base, decision: "create", reason: "From their latest invoice", stripeCustomerId: r.stripe_customer_id } as ImportRow & { stripeCustomerId: string | null };
  });

  // the latest finalized invoice, from Stripe when they're linked to it
  const eligible = out.filter((r) => r.decision === "create") as (ImportRow & { stripeCustomerId: string | null })[];
  for (let i = 0; i < eligible.length; i += 5)
    await Promise.all(
      eligible.slice(i, i + 5).map(async (r) => {
        if (!r.stripeCustomerId) return;
        try {
          r.invoice = await latestFromStripe(r.stripeCustomerId, r.propertyId);
        } catch {
          Object.assign(r, { decision: "skip", reason: "Couldn't read their invoices from Stripe" });
        }
      }),
    );
  for (const r of eligible) {
    delete (r as { stripeCustomerId?: string | null }).stripeCustomerId;
    if (r.decision !== "create") continue;
    if (!r.invoice) Object.assign(r, { decision: "skip", reason: "No finalized invoice" });
    else if (r.invoice.day < cutoff) Object.assign(r, { decision: "skip", reason: `Last invoice ${r.invoice.day}: more than 7 weeks ago` });
  }

  // the lines of the invoices that would be used (read from Stripe)
  if (withLines) {
    const todo = out.filter((r) => r.decision === "create");
    for (let i = 0; i < todo.length; i += 5)
      await Promise.all(
        todo.slice(i, i + 5).map(async (r) => {
          try {
            r.lines = await linesOf(r.invoice!.stripeInvoiceId);
            const sum = r.lines.reduce((s, l) => s + l.cents, 0);
            if (r.lines.length === 0) Object.assign(r, { decision: "skip", reason: "Its latest invoice has no lines" });
            else if (sum !== r.invoice!.totalCents) r.warning = `Lines add up to $${(sum / 100).toFixed(2)}, the invoice to $${(r.invoice!.totalCents / 100).toFixed(2)} (a discount or tax in Stripe?). The lines are used.`;
          } catch {
            Object.assign(r, { decision: "skip", reason: "Couldn't read the invoice from Stripe" });
          }
        }),
      );
  }
  return out;
}

// Creates the memorized invoices for the chosen plans, re-checking each one
// as it is now (so nothing stale or already done is saved).
export async function applyImport(today: string, planIds: number[], userId: number) {
  const chosen = new Set(planIds);
  const rows = (await importCandidates(today)).filter((r) => chosen.has(r.planId) && r.decision === "create");
  let created = 0;
  for (const r of rows) {
    // the app's own copy of that invoice (copied from Stripe if it isn't yet)
    const invoiceId = r.invoice!.id ?? (await syncInvoice(r.invoice!.stripeInvoiceId));
    await replaceMemorized(userId, {
      customerId: r.customerId,
      propertyId: r.propertyId,
      frequency: r.frequency!,
      lines: r.lines!,
      totalCents: r.lines!.reduce((s, l) => s + l.cents, 0),
      source: "invoice",
      sourceInvoiceId: invoiceId,
    });
    created++;
  }
  return { created, skipped: planIds.length - created };
}

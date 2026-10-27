import "server-only";

import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { customers, invoices, users } from "@/db/schema";
import { stripe } from "./stripe";

type InvoiceRow = typeof invoices.$inferInsert;
type Address = { line1?: string | null; postal_code?: string | null };

// Our customers that have a Stripe id, with their properties, so invoices can
// be linked to a customer and a property without a query per invoice.
async function loadLinkTargets(stripeCustomerIds?: string[]) {
  const rows = await db.query.customers.findMany({
    columns: { id: true, stripeCustomerId: true, billingPropertyId: true },
    where: stripeCustomerIds
      ? inArray(customers.stripeCustomerId, stripeCustomerIds)
      : isNotNull(customers.stripeCustomerId),
    with: { properties: { columns: { id: true, street: true, zip: true } } },
  });
  return new Map(rows.map((c) => [c.stripeCustomerId!, c]));
}
type LinkTargets = Awaited<ReturnType<typeof loadLinkTargets>>;

const normalize = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Which of the customer's properties an invoice is for: the one the app
// recorded when it created the invoice (metadata), else the property whose
// street and ZIP match the address printed on the invoice, else their
// billing property.
function matchProperty(
  customer: LinkTargets extends Map<string, infer C> ? C : never,
  metadata: Stripe.Metadata | null,
  address: Address | null,
) {
  const fromMetadata = Number(metadata?.app_property_id);
  if (customer.properties.some((p) => p.id === fromMetadata)) return fromMetadata;
  if (address?.line1) {
    const match = customer.properties.find(
      (p) => normalize(p.street) === normalize(address.line1) && (!address.postal_code || p.zip === address.postal_code),
    );
    if (match) return match.id;
  }
  return customer.billingPropertyId;
}

// How a paid invoice was paid: Stripe records a payment for money collected
// through it; an invoice marked paid outside Stripe has none.
function paidVia(invoice: Stripe.Invoice): InvoiceRow["paidVia"] {
  if (invoice.status !== "paid") return null;
  const collected = invoice.payments?.data.some(
    (p) => p.status === "paid" && (p.payment.type === "payment_intent" || p.payment.type === "charge"),
  );
  if (collected) return "stripe";
  return invoice.amount_paid > 0 || invoice.total === 0 ? "outside_stripe" : null;
}

// A payment recorded outside Stripe ("Cash", "Check #1042", "Zelle"): the app
// stores what was typed in the invoice's metadata, so it survives a re-sync.
export function classifyPaidWith(note: string): "cash" | "check" | "other" {
  const n = note.trim().toLowerCase();
  if (/^cash\b/.test(n)) return "cash";
  if (/^(check|cheque)\b/.test(n)) return "check";
  return "other";
}

function paidViaNote(invoice: Stripe.Invoice) {
  const note = invoice.metadata?.paid_via_note?.trim();
  return note ? note : null;
}

const httpsOnly = (url: string | null | undefined) => (url && /^https:\/\//.test(url) ? url : null);

const toIso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);

// Ids of the app's users, to accept a collected_by_user_id from Stripe only
// when it names someone who exists here.
async function loadUserIds() {
  return new Set((await db.select({ id: users.id }).from(users)).map((u) => u.id));
}

function toRow(invoice: Stripe.Invoice, targets: LinkTargets, userIds: Set<number>): InvoiceRow | null {
  const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!invoice.id || !stripeCustomerId || !invoice.status) return null;
  const customer = targets.get(stripeCustomerId);
  return {
    stripeInvoiceId: invoice.id,
    number: invoice.number,
    status: invoice.status as InvoiceRow["status"],
    stripeCustomerId,
    customerId: customer?.id ?? null,
    propertyId: customer ? matchProperty(customer, invoice.metadata, invoice.customer_address) : null,
    customerName: invoice.customer_name,
    customerEmail: invoice.customer_email,
    customerAddress: invoice.customer_address,
    description: invoice.description,
    currency: invoice.currency,
    totalCents: invoice.total,
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    amountRemainingCents: invoice.amount_remaining,
    createdAt: toIso(invoice.created)!,
    dueDate: toIso(invoice.due_date),
    finalizedAt: toIso(invoice.status_transitions?.finalized_at),
    paidAt: toIso(invoice.status_transitions?.paid_at),
    voidedAt: toIso(invoice.status_transitions?.voided_at),
    paidVia: paidVia(invoice) === "outside_stripe" && paidViaNote(invoice) ? classifyPaidWith(paidViaNote(invoice)!) : paidVia(invoice),
    paidViaNote: invoice.status === "paid" ? paidViaNote(invoice) : null,
    paidByUserId: invoice.status === "paid" && userIds.has(Number(invoice.metadata?.collected_by_user_id)) ? Number(invoice.metadata!.collected_by_user_id) : null,
    appointmentId: /^\d{1,15}$/.test(invoice.metadata?.app_appointment_id ?? "") ? Number(invoice.metadata!.app_appointment_id) : null,
    // shown as links: only ever https addresses
    hostedInvoiceUrl: httpsOnly(invoice.hosted_invoice_url),
    invoicePdfUrl: httpsOnly(invoice.invoice_pdf),
  };
}

// Insert or refresh invoices. Stripe's fields always win; a customer link
// made in the app is kept even if this sync didn't find one, and a property
// once set isn't recomputed.
// A visit's price is what it's invoiced for: the total of its invoices that
// aren't void (0 until it's invoiced). Revenue reports and percentage pay
// read it from the appointment.
export async function refreshVisitPrices(appointmentIds: (number | null | undefined)[]) {
  const ids = [...new Set(appointmentIds.filter((id): id is number => typeof id === "number"))];
  if (ids.length === 0) return;
  await db.execute(sql`
    update appointments a
    set price_cents = coalesce((select sum(i.total_cents) from invoices i where i.appointment_id = a.id and i.status <> 'void'), 0)
    where a.id in ${ids}
      and a.price_cents is distinct from coalesce((select sum(i.total_cents) from invoices i where i.appointment_id = a.id and i.status <> 'void'), 0)`);
}

async function upsert(rows: InvoiceRow[]) {
  if (rows.length === 0) return;
  await db
    .insert(invoices)
    .values(rows)
    .onConflictDoUpdate({
      target: invoices.stripeInvoiceId,
      set: {
        number: sql`excluded.number`,
        status: sql`excluded.status`,
        stripeCustomerId: sql`excluded.stripe_customer_id`,
        customerId: sql`coalesce(excluded.customer_id, ${invoices.customerId})`,
        propertyId: sql`coalesce(${invoices.propertyId}, excluded.property_id)`,
        customerName: sql`excluded.customer_name`,
        customerEmail: sql`excluded.customer_email`,
        customerAddress: sql`excluded.customer_address`,
        description: sql`excluded.description`,
        currency: sql`excluded.currency`,
        totalCents: sql`excluded.total_cents`,
        amountDueCents: sql`excluded.amount_due_cents`,
        amountPaidCents: sql`excluded.amount_paid_cents`,
        amountRemainingCents: sql`excluded.amount_remaining_cents`,
        dueDate: sql`excluded.due_date`,
        finalizedAt: sql`excluded.finalized_at`,
        paidAt: sql`excluded.paid_at`,
        voidedAt: sql`excluded.voided_at`,
        // keep cash/check recorded by the app; Stripe only knows "outside"
        paidVia: sql`case when ${invoices.paidVia} in ('cash', 'check', 'other') and excluded.paid_via = 'outside_stripe' then ${invoices.paidVia} else excluded.paid_via end`,
        paidViaNote: sql`coalesce(excluded.paid_via_note, ${invoices.paidViaNote})`,
        paidByUserId: sql`coalesce(excluded.paid_by_user_id, ${invoices.paidByUserId})`,
        appointmentId: sql`coalesce(excluded.appointment_id, ${invoices.appointmentId})`,
        hostedInvoiceUrl: sql`excluded.hosted_invoice_url`,
        invoicePdfUrl: sql`excluded.invoice_pdf_url`,
        syncedAt: sql`now()`,
      },
    });
  // the visits these invoices bill (linked by Stripe metadata or in the app)
  const linked = await db
    .select({ appointmentId: invoices.appointmentId })
    .from(invoices)
    .where(and(inArray(invoices.stripeInvoiceId, rows.map((r) => r.stripeInvoiceId)), isNotNull(invoices.appointmentId)));
  await refreshVisitPrices(linked.map((l) => l.appointmentId));
}

export type InvoiceSyncSummary = { synced: number; linked: number; removed: number };

// Copies every Stripe invoice into the app (100 per request). Draft invoices
// deleted in Stripe (only drafts can be) are removed here too.
export async function syncAllInvoices(): Promise<InvoiceSyncSummary> {
  const started = new Date().toISOString();
  const [targets, userIds] = await Promise.all([loadLinkTargets(), loadUserIds()]);
  let synced = 0;
  let linked = 0;
  let page: Stripe.ApiList<Stripe.Invoice> | undefined;
  do {
    page = await stripe().invoices.list({
      limit: 100,
      starting_after: page?.data.at(-1)?.id,
      expand: ["data.payments"],
    });
    const rows = page.data.map((inv) => toRow(inv, targets, userIds)).filter((r): r is InvoiceRow => r !== null);
    await upsert(rows);
    synced += rows.length;
    linked += rows.filter((r) => r.customerId).length;
  } while (page.has_more);

  const removed = await db
    .delete(invoices)
    .where(and(eq(invoices.status, "draft"), lt(invoices.syncedAt, started)))
    .returning({ id: invoices.id, appointmentId: invoices.appointmentId });
  await refreshVisitPrices(removed.map((r) => r.appointmentId));
  return { synced, linked, removed: removed.length };
}

// After a Stripe customer is linked to one of ours: attach their invoices and
// work out each one's property.
export async function linkInvoicesToCustomer(stripeCustomerId: string) {
  const targets = await loadLinkTargets([stripeCustomerId]);
  const customer = targets.get(stripeCustomerId);
  if (!customer) return;
  const rows = await db
    .select({ id: invoices.id, customerAddress: invoices.customerAddress })
    .from(invoices)
    .where(eq(invoices.stripeCustomerId, stripeCustomerId));
  await Promise.all(
    rows.map((r) =>
      db
        .update(invoices)
        .set({
          customerId: customer.id,
          propertyId: sql`coalesce(${invoices.propertyId}, ${matchProperty(customer, null, r.customerAddress as Address | null)})`,
        })
        .where(eq(invoices.id, r.id)),
    ),
  );
}


// Refreshes our copy of one invoice from Stripe (after creating or editing it
// in the app). Returns our invoice id.
export async function syncInvoice(stripeInvoiceId: string) {
  const invoice = await stripe().invoices.retrieve(stripeInvoiceId, { expand: ["payments"] });
  const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const [targets, userIds] = await Promise.all([loadLinkTargets(stripeCustomerId ? [stripeCustomerId] : []), loadUserIds()]);
  const row = toRow(invoice, targets, userIds);
  if (!row) throw new Error(`Stripe invoice ${stripeInvoiceId} couldn't be read.`);
  await upsert([row]);
  // an invoice the app created names its property; that always wins
  const fromMetadata = Number(invoice.metadata?.app_property_id);
  if (fromMetadata) await db.update(invoices).set({ propertyId: fromMetadata }).where(eq(invoices.stripeInvoiceId, stripeInvoiceId));
  const [saved] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.stripeInvoiceId, stripeInvoiceId));
  return saved.id;
}

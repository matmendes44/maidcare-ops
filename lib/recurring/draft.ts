import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, memorizedInvoices, properties } from "@/db/schema";
import { formatAddress } from "@/app/(app)/properties/options";
import { TIME_ZONE } from "@/lib/i18n/config";
import { describeStripeError, isStripeConfigured, stripe } from "@/lib/stripe";
import { createStripeCustomer } from "@/lib/stripe-customers";
import { phrase } from "@/lib/i18n/tr";
import { syncInvoice } from "@/lib/stripe-invoices";

export type MemorizedLine = { description: string; cents: number };

// A draft invoice for one recurring visit, made from the customer's memorized
// invoice: the same lines, dated for that day. Only the owner finalizes it.
// Safe to retry: the idempotency key returns the same draft. By default it's
// one per day (Invoice & book); a booking passes its own, so two visits on
// the same day get a draft each.
export async function draftFromMemorized(memorizedId: number, day: string, userId: number, idempotencyKey?: string): Promise<{ id: number; stripeInvoiceId: string } | { error: string }> {
  if (!isStripeConfigured()) return { error: phrase("Stripe isn't connected.") };
  const [m] = await db.select().from(memorizedInvoices).where(eq(memorizedInvoices.id, memorizedId));
  if (!m || !m.isActive) return { error: phrase("This recurring invoice was changed. Reload and try again.") };
  const [customer] = await db.select().from(customers).where(eq(customers.id, m.customerId));
  if (!customer) return { error: phrase("The customer no longer exists.") };
  const [property] = m.propertyId ? await db.select().from(properties).where(eq(properties.id, m.propertyId)) : [];
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    const created = await createStripeCustomer(customer.id);
    if (!created.ok) return { error: `Couldn't create the customer in Stripe: ${created.error}` };
    stripeCustomerId = created.stripeCustomerId;
  }
  // the day's first and last second, so Stripe prints it as the service date
  const { rows } = await db.execute<{ start: number; end: number }>(
    sql`select extract(epoch from (${day}::date::timestamp at time zone ${TIME_ZONE}))::bigint as start,
               extract(epoch from ((${day}::date + 1)::timestamp at time zone ${TIME_ZONE}))::bigint - 1 as end`,
  );
  const period = { start: Number(rows[0].start), end: Number(rows[0].end) };
  const lines = m.lines as MemorizedLine[];
  const key = idempotencyKey ?? `maidcare-recurring-${m.id}-${day}`;
  try {
    const sc = await stripe().customers.retrieve(stripeCustomerId);
    const draft = await stripe().invoices.create(
      {
        customer: stripeCustomerId,
        auto_advance: false,
        ...(!sc.deleted && sc.email ? { collection_method: "send_invoice" as const, days_until_due: 14 } : { collection_method: "charge_automatically" as const }),
        pending_invoice_items_behavior: "exclude",
        description: `Recurring cleaning visit`,
        ...(property ? { custom_fields: [{ name: "Service address", value: formatAddress(property).slice(0, 140) }] } : {}),
        metadata: {
          app_customer_id: String(customer.id),
          customer_code: customer.customerCode,
          created_by_user_id: String(userId),
          app_memorized_invoice_id: String(m.id),
          ...(property ? { app_property_id: String(property.id) } : {}),
        },
      },
      { idempotencyKey: key },
    );
    for (const [i, line] of lines.entries())
      await stripe().invoiceItems.create(
        { customer: stripeCustomerId, invoice: draft.id!, description: line.description.slice(0, 500), amount: line.cents, currency: "usd", period, metadata: { position: String(i), service_date: day } },
        { idempotencyKey: `${key}-line-${i}` },
      );
    return { id: await syncInvoice(draft.id!), stripeInvoiceId: draft.id! };
  } catch (err) {
    return { error: describeStripeError(err) };
  }
}

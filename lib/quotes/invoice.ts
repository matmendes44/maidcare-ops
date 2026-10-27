import "server-only";

import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { customers, memorizedInvoices, properties, quoteAcceptances, quoteEvents, quotes } from "@/db/schema";
import { replaceMemorized } from "@/lib/recurring/memorize";
import { frequencyFromLabel } from "@/lib/recurring/schedule";
import { formatAddress } from "@/app/(app)/properties/options";
import { logError } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { createStripeCustomer } from "@/lib/stripe-customers";
import { describeStripeError, isStripeConfigured, stripe } from "@/lib/stripe";
import { syncInvoice } from "@/lib/stripe-invoices";
import { checkContent, totalFor } from "./content";
import { phrase } from "@/lib/i18n/tr";

type Line = { description: string; cents: number };

// Turns an accepted quote into a draft invoice in Stripe for the first visit
// (the chosen option and any add-ons picked, nothing else) and, when the plan
// repeats, the customer's memorized invoice for the recurring visits (each
// one's draft is made when it's booked). Like
// invoices made in the app they stay drafts (nothing is numbered, emailed or
// charged) until someone acts on them. Safe to run again: each invoice is
// made once, and the idempotency keys make retries return the same Stripe
// invoice. Records the result on the quote either way.
export async function invoiceAcceptedQuote(quoteId: number) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  const [acc] = await db.select().from(quoteAcceptances).where(eq(quoteAcceptances.quoteId, quoteId));
  if (!q || !acc) return;

  // what was accepted, from the snapshot the customer agreed to
  const snapshot = acc.snapshot as { content: unknown };
  const content = checkContent(snapshot.content).content;
  // one recurring plan (estimates from the price list); older estimates with
  // several plans are invoiced for the first visit only
  const recurring = content.recurring.length === 1 ? content.recurring[0] : null;
  const [memorized] = recurring ? await db.select({ id: memorizedInvoices.id }).from(memorizedInvoices).where(eq(memorizedInvoices.sourceQuoteId, quoteId)) : [];
  if (q.invoiceId && (!recurring || memorized || q.recurringInvoiceId)) return;

  const fail = async (error: string) => {
    await db.batch([
      db.update(quotes).set({ invoiceError: error }).where(eq(quotes.id, quoteId)),
      db.insert(quoteEvents).values({ quoteId, kind: "invoice_failed", detail: { error } }),
    ]);
    await notify({ kind: "quote_invoice_failed", title: "Estimate #{number}: draft invoice not made", body: error, href: `/finances/estimates/${quoteId}`, vars: { number: q.quoteNumber } });
  };
  if (!isStripeConfigured()) return fail(phrase("Stripe isn't connected."));
  const choice = totalFor(content, acc.optionId, acc.addOnIds);
  if (!choice || choice.totalCents !== acc.totalCents) return fail(phrase("The accepted choice no longer adds up. Make the invoice by hand."));

  const [customer] = await db.select().from(customers).where(eq(customers.id, q.customerId));
  if (!customer) return fail(phrase("The customer no longer exists."));
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    const created = await createStripeCustomer(customer.id);
    if (!created.ok) return fail(`Couldn't create the customer in Stripe: ${created.error}`);
    stripeCustomerId = created.stripeCustomerId;
  }
  const [property] = q.propertyId ? await db.select().from(properties).where(eq(properties.id, q.propertyId)) : [];
  const key = `maidcare-quote-${quoteId}-v${acc.quoteVersion}`;

  // one draft invoice with these lines; its id in the app, or why it failed
  async function draftInvoice(idempotencyKey: string, description: string, lines: Line[], expectedCents: number): Promise<{ id: number } | { error: string }> {
    const sc = await stripe().customers.retrieve(stripeCustomerId!);
    const draft = await stripe().invoices.create(
      {
        customer: stripeCustomerId!,
        auto_advance: false,
        // send_invoice needs an email on the customer; due in 14 days
        ...(!sc.deleted && sc.email ? { collection_method: "send_invoice" as const, days_until_due: 14 } : { collection_method: "charge_automatically" as const }),
        pending_invoice_items_behavior: "exclude",
        description,
        ...(property ? { custom_fields: [{ name: "Service address", value: formatAddress(property).slice(0, 140) }] } : {}),
        metadata: { app_customer_id: String(customer.id), customer_code: customer.customerCode, app_quote_id: String(quoteId), quote_number: String(q.quoteNumber), ...(property ? { app_property_id: String(property.id) } : {}) },
      },
      { idempotencyKey },
    );
    for (const [i, line] of lines.entries()) {
      const params: Stripe.InvoiceItemCreateParams = { customer: stripeCustomerId!, invoice: draft.id!, description: line.description.slice(0, 500), amount: line.cents, currency: "usd", metadata: { position: String(i) } };
      await stripe().invoiceItems.create(params, { idempotencyKey: `${idempotencyKey}-line-${i}` });
    }
    const check = await stripe().invoices.retrieve(draft.id!);
    if (check.total !== expectedCents) {
      await stripe().invoices.del(draft.id!).catch(() => {});
      return { error: `Stripe totaled the invoice to $${((check.total ?? 0) / 100).toFixed(2)} instead of $${(expectedCents / 100).toFixed(2)} (a discount or tax on the customer in Stripe?). Make the invoice by hand.` };
    }
    return { id: await syncInvoice(draft.id!) };
  }

  try {
    if (!q.invoiceId) {
      const made = await draftInvoice(
        key,
        `Estimate #${q.quoteNumber}, accepted online: first visit`,
        [
          { description: [choice.option.name, choice.option.description].filter(Boolean).join(": "), cents: choice.option.priceCents },
          ...choice.addOns.map((a) => ({ description: [a.name, a.description].filter(Boolean).join(": "), cents: a.priceCents })),
          ...(choice.taxCents ? [{ description: `Sales tax (${content.taxBp / 100}%)`, cents: choice.taxCents }] : []),
        ],
        acc.totalCents,
      );
      if ("error" in made) return fail(made.error);
      await db.batch([
        db.update(quotes).set({ invoiceId: made.id, invoiceError: null }).where(eq(quotes.id, quoteId)),
        db.insert(quoteEvents).values({ quoteId, kind: "invoice_created", detail: { invoiceId: made.id } }),
      ]);
    }
    // the recurring plan becomes the customer's memorized invoice: each later
    // visit gets a draft made from it when it's booked (Invoice & book)
    if (recurring && !memorized && !q.recurringInvoiceId) {
      const frequency = frequencyFromLabel(recurring.when);
      if (!frequency) return fail(`Couldn't tell how often "${recurring.when}" repeats. Set the recurring invoice by hand.`);
      await replaceMemorized(null, {
        customerId: q.customerId,
        propertyId: q.propertyId,
        frequency,
        lines: [{ description: `${recurring.name}, ${recurring.when.toLowerCase()}: ${recurring.description}`, cents: recurring.priceCents }],
        totalCents: recurring.priceCents,
        source: "estimate",
        sourceQuoteId: quoteId,
      });
      await db.batch([
        db.update(quotes).set({ invoiceError: null }).where(eq(quotes.id, quoteId)),
        db.insert(quoteEvents).values({ quoteId, kind: "invoice_created", detail: { memorized: true } }),
      ]);
    }
  } catch (err) {
    logError("quote invoice failed", err);
    return fail(describeStripeError(err));
  }
}

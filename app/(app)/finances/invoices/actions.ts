"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { db } from "@/db";
import { appointments, customers, invoices, properties } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireUser, checkPermission } from "@/lib/auth/session";
import { TIME_ZONE } from "@/lib/i18n/config";
import { describeStripeError, stripe } from "@/lib/stripe";
import { createStripeCustomer } from "@/lib/stripe-customers";
import { refreshVisitPrices, syncInvoice } from "@/lib/stripe-invoices";
import { displayName } from "../../customers/options";
import { formatAddress } from "../../properties/options";
import { MAX_TOTAL_CENTS, MAX_UNIT_CENTS, parseCents, parseQuantity } from "./money";
import { logError } from "@/lib/log";

export type InvoiceFormState = {
  errors?: Partial<Record<"customerId" | "propertyId" | "dueDate" | "memo" | "lines", string>>;
  lineErrors?: Record<number, string>;
  message?: string;
};

// serviceDate: optional "YYYY-MM-DD", when the work was done
type Line = { description: string; quantity: number; unitCents: number; serviceDate: string | null };

const MAX_LINES = 50;

function isValidDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

// A calendar date's first and last second in the business's time zone, as
// Stripe's unix seconds (Postgres knows daylight saving). A line's period over
// one whole day is what Stripe prints as its service date, e.g. "Oct 14,
// 2026"; a period that starts and ends at the same instant isn't printed.
async function easternDaySeconds(day: string) {
  const { rows } = await db.execute<{ start: number; end: number }>(
    sql`select extract(epoch from (${day}::date::timestamp at time zone ${TIME_ZONE}))::bigint as start,
               extract(epoch from ((${day}::date + 1)::timestamp at time zone ${TIME_ZONE}))::bigint - 1 as end`,
  );
  return { start: Number(rows[0].start), end: Number(rows[0].end) };
}

function parse(formData: FormData) {
  const text = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const errors: NonNullable<InvoiceFormState["errors"]> = {};
  const lineErrors: Record<number, string> = {};

  const customerId = /^\d+$/.test(text("customerId")) ? Number(text("customerId")) : null;
  if (customerId === null) errors.customerId = "Choose a customer.";
  const propertyId = /^\d+$/.test(text("propertyId")) ? Number(text("propertyId")) : null;
  if (propertyId === null) errors.propertyId = "Choose the property this invoice is for.";

  const dueDate = text("dueDate");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) errors.dueDate = "Choose a due date.";
  // "YYYY-MM-DD" strings compare correctly
  else if (dueDate < today) errors.dueDate = "The due date can't be in the past.";

  const memo = text("memo");
  if (memo.length > 500) errors.memo = "Keep the memo under 500 characters.";

  const descriptions = formData.getAll("lineDescription").map(String);
  const quantities = formData.getAll("lineQuantity").map(String);
  const prices = formData.getAll("linePrice").map(String);
  const serviceDates = formData.getAll("lineServiceDate").map(String);
  const lines: Line[] = [];
  descriptions.forEach((raw, i) => {
    const description = raw.trim();
    const qtyRaw = (quantities[i] ?? "").trim();
    const priceRaw = (prices[i] ?? "").trim();
    const serviceDate = (serviceDates[i] ?? "").trim() || null;
    // a completely empty row is ignored
    if (!description && !priceRaw && (!qtyRaw || qtyRaw === "1")) return;
    const quantity = parseQuantity(qtyRaw || "1");
    const unitCents = parseCents(priceRaw);
    if (!description) lineErrors[i] = "Add a description.";
    else if (description.length > 500) lineErrors[i] = "Keep the description under 500 characters.";
    else if (quantity === null) lineErrors[i] = "Quantity must be a whole number from 1 to 999.";
    else if (unitCents === null) lineErrors[i] = "Enter a price, e.g. 150 or 150.00 (negative for a discount).";
    else if (Math.abs(unitCents) > MAX_UNIT_CENTS || Math.abs(unitCents * quantity) > MAX_TOTAL_CENTS)
      lineErrors[i] = "That amount is too large. Check the price and quantity.";
    else if (serviceDate && !isValidDay(serviceDate)) lineErrors[i] = "Enter a valid service date.";
    else lines.push({ description, quantity, unitCents, serviceDate });
  });
  if (lines.length === 0 && Object.keys(lineErrors).length === 0) errors.lines = "Add at least one line item.";
  if (lines.length > MAX_LINES) errors.lines = `An invoice can have at most ${MAX_LINES} lines.`;
  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitCents, 0);
  if (lines.length > 0 && total < 0) errors.lines = "The total can't be negative.";
  if (total > MAX_TOTAL_CENTS) errors.lines = "The total is too large. Check the prices and quantities.";

  return {
    customerId: customerId!,
    propertyId: propertyId!,
    dueDate,
    memo,
    lines,
    total,
    errors,
    lineErrors,
    hasErrors: Object.keys(errors).length > 0 || Object.keys(lineErrors).length > 0,
  };
}

// End of the due date in the business's time zone, as Stripe's unix seconds.
async function dueDateSeconds(day: string) {
  const { rows } = await db.execute<{ s: number }>(
    // 23:59:59 local, converted by Postgres (it knows daylight saving)
    sql`select extract(epoch from (${`${day} 23:59:59`}::timestamp at time zone ${TIME_ZONE}))::bigint as s`,
  );
  return Number(rows[0].s);
}

// How Stripe would collect. "Send invoice" (with a due date) needs an email
// on the Stripe customer; customers without one get "charge automatically",
// which has no due date. Either way auto_advance stays off, so Stripe never
// emails or charges an invoice on its own.
async function collectionFields(stripeCustomerId: string, dueDate: string) {
  const sc = await stripe().customers.retrieve(stripeCustomerId);
  return !sc.deleted && sc.email
    ? { collection_method: "send_invoice" as const, due_date: await dueDateSeconds(dueDate) }
    : { collection_method: "charge_automatically" as const };
}

// Lines become invoice items on the draft. Positive prices use quantity ×
// unit price; a negative (discount) line is a single negative amount. Each
// remembers its position (Stripe lists an invoice's lines newest first) and
// its service date: Stripe prints a line's period as its service date, and the
// metadata tells a chosen date apart from Stripe's default (creation time).
async function addLines(invoiceId: string, stripeCustomerId: string, lines: Line[], keyPrefix?: string) {
  for (const [i, line] of lines.entries()) {
    const shared = {
      metadata: { position: String(i), ...(line.serviceDate ? { service_date: line.serviceDate } : {}) },
      ...(line.serviceDate ? { period: await easternDaySeconds(line.serviceDate) } : {}),
    };
    const params: Stripe.InvoiceItemCreateParams =
      line.unitCents >= 0
        ? {
            customer: stripeCustomerId,
            invoice: invoiceId,
            description: line.description,
            quantity: line.quantity,
            unit_amount_decimal: Stripe.Decimal.from(String(line.unitCents)),
            currency: "usd",
            ...shared,
          }
        : {
            customer: stripeCustomerId,
            invoice: invoiceId,
            description: line.description,
            amount: line.unitCents * line.quantity,
            currency: "usd",
            ...shared,
          };
    await stripe().invoiceItems.create(params, keyPrefix ? { idempotencyKey: `${keyPrefix}-line-${i}` } : undefined);
  }
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

// What Stripe totals the draft to, compared with the lines on the form. They
// differ if something in Stripe changes the amount (a customer discount, tax)
// or a line didn't save as sent.
async function stripeTotalMismatch(stripeInvoiceId: string, expected: number) {
  const inv = await stripe().invoices.retrieve(stripeInvoiceId);
  return inv.total === expected && inv.subtotal === expected ? null : inv.total;
}

// The property and who it's for, checked against our database.
async function loadParties(customerId: number, propertyId: number) {
  const [customer, property] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, customerId) }),
    db.query.properties.findFirst({ where: eq(properties.id, propertyId) }),
  ]);
  return { customer, property };
}

function invoiceFields(
  customer: NonNullable<Awaited<ReturnType<typeof loadParties>>["customer"]>,
  property: NonNullable<Awaited<ReturnType<typeof loadParties>>["property"]>,
  memo: string,
  userId: number,
  // the visit this invoice bills, when it was started from one
  appointmentId?: number | null,
) {
  return {
    description: memo,
    // printed on the invoice; Stripe allows up to 140 characters
    custom_fields: [{ name: "Service address", value: formatAddress(property).slice(0, 140) }],
    metadata: {
      app_customer_id: String(customer.id),
      app_property_id: String(property.id),
      customer_code: customer.customerCode,
      created_by_user_id: String(userId),
      ...(appointmentId ? { app_appointment_id: String(appointmentId) } : {}),
    },
  };
}

export async function createInvoice(_prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const user = await requireUser();
  if (!can(user, "invoices.create")) return { message: "You don't have permission to make invoices." };
  const parsed = parse(formData);
  if (parsed.hasErrors) return { errors: parsed.errors, lineErrors: parsed.lineErrors };

  const { customer, property } = await loadParties(parsed.customerId, parsed.propertyId);
  if (!customer) return { errors: { customerId: "That customer no longer exists." } };
  if (!property || property.customerId !== customer.id)
    return { errors: { propertyId: "That property doesn't belong to this customer." } };

  // invoices need a Stripe customer; create one if they don't have it yet
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    const created = await createStripeCustomer(customer.id);
    if (!created.ok) return { message: `Couldn't create ${displayName(customer)} in Stripe: ${created.error}` };
    stripeCustomerId = created.stripeCustomerId;
  }

  // started from a visit (Fleet page): only kept if it's this customer's
  const appointmentRaw = String(formData.get("appointmentId") ?? "");
  const appointment = /^\d+$/.test(appointmentRaw)
    ? await db.query.appointments.findFirst({ columns: { id: true, customerId: true }, where: eq(appointments.id, Number(appointmentRaw)) })
    : undefined;
  const appointmentId = appointment?.customerId === customer.id ? appointment.id : null;

  // one key per form, so a double click or retry can't create two invoices
  const token = String(formData.get("token") ?? "");
  const key = /^[\w-]{16,64}$/.test(token) ? `maidcare-invoice-${token}` : undefined;

  let stripeInvoiceId: string;
  try {
    const draft = await stripe().invoices.create(
      {
        customer: stripeCustomerId,
        // a draft that stays a draft: nothing is numbered, emailed or charged
        // until someone does that from the app
        auto_advance: false,
        ...(await collectionFields(stripeCustomerId, parsed.dueDate)),
        // only the lines on this form, never stray pending items
        pending_invoice_items_behavior: "exclude",
        ...invoiceFields(customer, property, parsed.memo, user.id, appointmentId),
      },
      key ? { idempotencyKey: key } : undefined,
    );
    stripeInvoiceId = draft.id!;
    try {
      await addLines(stripeInvoiceId, stripeCustomerId, parsed.lines, key);
    } catch (err) {
      // don't leave a half-built draft behind
      await stripe().invoices.del(stripeInvoiceId).catch(() => {});
      throw err;
    }
    const actual = await stripeTotalMismatch(stripeInvoiceId, parsed.total);
    if (actual !== null) {
      await stripe().invoices.del(stripeInvoiceId).catch(() => {});
      return {
        message: `Stripe totaled this invoice to ${usd(actual)} instead of ${usd(parsed.total)}, so it wasn't saved. Check for a discount or tax set up on the customer in Stripe.`,
      };
    }
  } catch (err) {
    logError("invoice create failed", err);
    return { message: describeStripeError(err) };
  }

  const id = await syncInvoice(stripeInvoiceId);
  redirect(`/finances/invoices/${id}?saved=created`);
}

export async function updateInvoice(id: number, _prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const user = await requireUser();
  if (!can(user, "invoices.create")) return { message: "You don't have permission to edit invoices." };
  const row = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!row) return { message: "This invoice no longer exists." };
  // the customer can't change on a Stripe invoice
  formData.set("customerId", String(row.customerId ?? ""));
  const parsed = parse(formData);
  if (parsed.hasErrors) return { errors: parsed.errors, lineErrors: parsed.lineErrors };

  const { customer, property } = await loadParties(parsed.customerId, parsed.propertyId);
  if (!customer) return { message: "This invoice isn't linked to a customer. Link it on the Finances page first." };
  if (!property || property.customerId !== customer.id)
    return { errors: { propertyId: "That property doesn't belong to this customer." } };

  try {
    const current = await stripe().invoices.retrieve(row.stripeInvoiceId);
    if (current.status !== "draft") return { message: "Only draft invoices can be edited." };
    await stripe().invoices.update(row.stripeInvoiceId, {
      // re-checked in case their Stripe email was added or removed
      ...(await collectionFields(row.stripeCustomerId, parsed.dueDate)),
      ...invoiceFields(customer, property, parsed.memo, user.id),
    });
    // replace the lines with the ones on the form
    const existing = await stripe()
      .invoices.listLineItems(row.stripeInvoiceId, { limit: 100 })
      .autoPagingToArray({ limit: 500 });
    for (const line of existing) {
      const itemId = line.parent?.invoice_item_details?.invoice_item;
      if (itemId) await stripe().invoiceItems.del(itemId);
    }
    await addLines(row.stripeInvoiceId, row.stripeCustomerId, parsed.lines);
    const actual = await stripeTotalMismatch(row.stripeInvoiceId, parsed.total);
    if (actual !== null) {
      await syncInvoice(row.stripeInvoiceId);
      return {
        message: `Saved, but Stripe totals this invoice to ${usd(actual)} instead of ${usd(parsed.total)}. Check the invoice in Stripe before charging it.`,
      };
    }
  } catch (err) {
    logError("invoice update failed", err);
    await syncInvoice(row.stripeInvoiceId).catch(() => {});
    return { message: `${describeStripeError(err)} Check the invoice: some changes may not have been saved.` };
  }

  await syncInvoice(row.stripeInvoiceId);
  redirect(`/finances/invoices/${id}?saved=updated`);
}

export type FinalizeInvoiceState = { message?: string };

// Finalizing makes Stripe number the invoice and lock its lines. With
// auto_advance off it is not emailed and no payment is attempted: it stays
// open until it's charged, marked paid or voided.
export async function finalizeInvoice(id: number): Promise<FinalizeInvoiceState> {
  const access = await checkPermission("invoices.finalize");
  if (!access.user) return { message: access.denied };
  const row = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!row) return { message: "This invoice no longer exists." };
  try {
    const current = await stripe().invoices.retrieve(row.stripeInvoiceId);
    if (current.status !== "draft") {
      await syncInvoice(row.stripeInvoiceId);
      return { message: "This invoice is already finalized." };
    }
    if (current.lines.data.length === 0) return { message: "Add at least one line item before finalizing." };
    await stripe().invoices.finalizeInvoice(row.stripeInvoiceId, { auto_advance: false });
  } catch (err) {
    logError("invoice finalize failed", err);
    return { message: describeStripeError(err) };
  }
  await syncInvoice(row.stripeInvoiceId);
  redirect(`/finances/invoices/${id}?saved=finalized`);
}

export type ChargeInvoiceState = { message?: string };

// Collects an invoice: charges a card saved on the customer, or marks it paid
// outside Stripe with what it was paid with ("Cash", "Check #1042"). A draft
// is finalized (numbered) first. Nothing here emails the customer.
//
// Safeguards against charging the wrong amount or charging twice:
// - The dialog sends the amount it showed (expectedCents). Stripe always
//   collects the invoice's amount remaining, so that must equal what was
//   confirmed: checked before finalizing a draft (someone may have edited it
//   since) and again right before paying (finalizing can apply a customer's
//   credit balance). Once finalized an invoice's lines can't change.
// - Stripe pays an invoice at most once; a second attempt fails. The
//   idempotency key (one per attempt from the dialog) also turns a resent
//   request into a replay of the first instead of a second charge.
export async function chargeInvoice(id: number, _prev: ChargeInvoiceState, formData: FormData): Promise<ChargeInvoiceState> {
  const access = await checkPermission("invoices.collect");
  if (!access.user) return { message: access.denied };
  const user = access.user;
  const row = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!row) return { message: "This invoice no longer exists." };

  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const method = text("method");
  const paymentMethodId = text("paymentMethodId");
  const paidWith = text("paidWith");
  const reference = text("reference");
  const expected = /^\d{1,9}$/.test(text("expectedCents")) ? Number(text("expectedCents")) : null;
  if (method !== "card" && method !== "external") return { message: "Choose how it was paid." };
  if (method === "card" && !/^(pm|card)_\w+$/.test(paymentMethodId)) return { message: "Choose a card." };
  if (method === "external" && !paidWith) return { message: "Enter what it was paid with, e.g. Cash or Check." };
  if (paidWith.length > 60 || reference.length > 80) return { message: "Keep the payment details short." };
  if (!expected) return { message: "Reload the page and try again." };
  const note = reference ? `${paidWith} ${reference}` : paidWith;
  const token = text("token");
  const key = /^[\w-]{16,64}$/.test(token)
    ? `maidcare-pay-${row.stripeInvoiceId}-${token}-${method === "card" ? paymentMethodId : "oob"}`
    : undefined;

  // the amount changed since the dialog was opened: show the new one, charge nothing
  const changed = async (now: number, finalized: boolean) => {
    await syncInvoice(row.stripeInvoiceId).catch(() => {});
    refresh();
    return {
      message: `Nothing was charged: the amount due is now ${usd(now)}, not the ${usd(expected)} you confirmed${
        finalized ? " (Stripe applied the customer's credit when finalizing)" : ""
      }. Check the invoice and try again.`,
    };
  };

  // Paid or voided in the meantime (another tab, the Stripe dashboard): the
  // page reloads to show that, with a notice, since the dialog goes away.
  let alreadyClosed: string | null = null;
  try {
    let current = await stripe().invoices.retrieve(row.stripeInvoiceId);
    if (current.status !== "draft" && current.status !== "open") alreadyClosed = current.status;
    else {
      if (current.status === "draft") {
        if (current.lines.data.length === 0) return { message: "Add at least one line item first." };
        if (current.total !== expected) return await changed(current.total, false);
      }

      if (method === "card") {
        // only a card saved on this invoice's customer
        const pm = await stripe().paymentMethods.retrieve(paymentMethodId);
        if (pm.customer !== row.stripeCustomerId) return { message: "That card doesn't belong to this customer." };
      }
      if (current.status === "draft") {
        current = await stripe().invoices.finalizeInvoice(row.stripeInvoiceId, { auto_advance: false });
        if (current.amount_remaining !== expected) return await changed(current.amount_remaining, true);
      } else if (current.amount_remaining !== expected) {
        return await changed(current.amount_remaining, false);
      }
      if (current.amount_remaining <= 0) return { message: "Nothing is due on this invoice." };

      if (method === "external") await stripe().invoices.update(row.stripeInvoiceId, { metadata: { paid_via_note: note } });
      await stripe().invoices.pay(
        row.stripeInvoiceId,
        method === "card" ? { payment_method: paymentMethodId, off_session: true } : { paid_out_of_band: true },
        key ? { idempotencyKey: key } : undefined,
      );
    }
  } catch (err) {
    logError("invoice charge failed", err);
    await syncInvoice(row.stripeInvoiceId).catch(() => {});
    refresh();
    if (err instanceof Stripe.errors.StripeCardError) {
      if (err.code === "authentication_required" || err.code === "invoice_payment_intent_requires_action")
        return { message: "The card's bank wants the customer to confirm this payment. Send them the invoice link to pay it themselves." };
      return { message: `The card was declined: ${err.message}` };
    }
    // lost a race with another payment of the same invoice
    const now = await stripe().invoices.retrieve(row.stripeInvoiceId).catch(() => null);
    if (now?.status === "paid" || now?.status === "void") alreadyClosed = now.status;
    else return { message: describeStripeError(err) };
  }

  if (alreadyClosed) {
    await syncInvoice(row.stripeInvoiceId);
    redirect(`/finances/invoices/${id}?saved=already-${alreadyClosed}`);
  }
  // who collected it: on our invoice, and in Stripe's metadata (metadata can
  // still be changed once an invoice is paid). A failure here never undoes
  // the payment; the app's own record is written regardless.
  await db.update(invoices).set({ paidByUserId: user.id }).where(eq(invoices.id, id));
  await stripe()
    .invoices.update(row.stripeInvoiceId, {
      metadata: { collected_by_user_id: String(user.id), collected_by: `${user.name} <${user.email}>`.slice(0, 500) },
    })
    .catch((err) => logError("recording who collected the invoice in Stripe failed", err));
  await syncInvoice(row.stripeInvoiceId);
  redirect(`/finances/invoices/${id}?saved=${method === "card" ? "charged" : "paid"}`);
}

export type DeleteInvoiceState = { message?: string };

// Drafts can be deleted outright (Stripe never numbered them).
export async function deleteDraftInvoice(id: number): Promise<DeleteInvoiceState> {
  const access = await checkPermission("invoices.deleteDraft");
  if (!access.user) return { message: access.denied };
  const row = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!row) return { message: "This invoice no longer exists." };
  try {
    const current = await stripe().invoices.retrieve(row.stripeInvoiceId);
    if (current.status !== "draft") return { message: "Only draft invoices can be deleted. Void it instead." };
    await stripe().invoices.del(row.stripeInvoiceId);
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing")) {
      logError("invoice delete failed", err);
      return { message: describeStripeError(err) };
    }
  }
  const gone = await db.delete(invoices).where(eq(invoices.id, id)).returning({ appointmentId: invoices.appointmentId });
  await refreshVisitPrices(gone.map((g) => g.appointmentId));
  redirect(`/finances?deleted=draft`);
}

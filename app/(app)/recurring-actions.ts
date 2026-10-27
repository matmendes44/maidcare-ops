"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { db } from "@/db";
import { invoices, memorizedInvoices, memorizedSkips } from "@/db/schema";
import { checkPermission, requireUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db-helpers";
import { getI18n } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { draftFromMemorized, type MemorizedLine } from "@/lib/recurring/draft";
import { replaceMemorized } from "@/lib/recurring/memorize";
import { isFrequency } from "@/lib/recurring/schedule";
import { describeStripeError, stripe } from "@/lib/stripe";

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// "Invoice & book" on an expected visit: a draft invoice from the memorized
// one, then the booking form filled in with it (the customer, property, day
// and time). Anyone can do this; only the owner finalizes the invoice later.
export async function invoiceAndBook(memorizedId: number, day: string, start: string, end: string): Promise<{ message?: string }> {
  const [user, { tr }] = await Promise.all([requireUser(), getI18n()]);
  if (!isDay(day) || !isTime(start) || !isTime(end)) return { message: tr("That visit couldn't be read. Reload and try again.") };
  const made = await draftFromMemorized(memorizedId, day, user.id);
  if ("error" in made) return { message: tr(made.error) };
  const [m] = await db.select({ customerId: memorizedInvoices.customerId, propertyId: memorizedInvoices.propertyId }).from(memorizedInvoices).where(eq(memorizedInvoices.id, memorizedId));
  const q = new URLSearchParams({ customer: String(m.customerId), date: day, start, end, invoice: String(made.id) });
  if (m.propertyId) q.set("property", String(m.propertyId));
  redirect(`/appointments/new?${q}`);
}

// "Skip" on an expected visit (the customer is away): the schedule carries on
// from that day.
export async function skipExpected(memorizedId: number, day: string): Promise<{ message?: string }> {
  const [user, { tr }] = await Promise.all([requireUser(), getI18n()]);
  if (!isDay(day)) return { message: tr("That day couldn't be read.") };
  await db.insert(memorizedSkips).values({ memorizedInvoiceId: memorizedId, day, createdBy: user.id }).onConflictDoNothing();
  refresh();
  return {};
}

// "Set as recurring invoice" on an invoice: its lines become the customer's
// memorized invoice for that property, repeating as often as chosen. It
// replaces the one they had.
export async function setRecurringFromInvoice(invoiceId: number, frequency: string): Promise<{ message?: string }> {
  const access = await checkPermission("invoices.memorize");
  if (!access.user) return { message: access.denied };
  if (!isFrequency(frequency)) return { message: "Choose how often it repeats." };
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv?.customerId) return { message: "This invoice isn't linked to a customer." };
  if (inv.status === "void") return { message: "A void invoice can't be the recurring one." };
  let lines: MemorizedLine[];
  try {
    const items = await stripe().invoices.listLineItems(inv.stripeInvoiceId, { limit: 100 });
    // Stripe lists the newest line first
    lines = items.data
      .map((l) => ({ description: l.description ?? "Cleaning", cents: l.amount, position: Number((l.metadata as Stripe.Metadata | null)?.position ?? 0) }))
      .sort((a, b) => a.position - b.position)
      .map(({ description, cents }) => ({ description, cents }));
  } catch (err) {
    logError("memorize invoice failed", err);
    return { message: describeStripeError(err) };
  }
  if (lines.length === 0) return { message: "This invoice has no lines to repeat." };
  await replaceMemorized(access.user.id, {
    customerId: inv.customerId,
    propertyId: inv.propertyId,
    frequency,
    lines,
    totalCents: lines.reduce((s, l) => s + l.cents, 0),
    source: "invoice",
    sourceInvoiceId: inv.id,
  });
  refresh();
  return {};
}

// On the customer's page: how often it repeats, a pause, or stopping it.
export async function updateRecurring(memorizedId: number, change: { frequency?: string; pausedUntil?: string | null; stop?: boolean }): Promise<{ message?: string }> {
  const access = await checkPermission("invoices.memorize");
  if (!access.user) return { message: access.denied };
  const set: Partial<typeof memorizedInvoices.$inferInsert> = {};
  if (change.frequency !== undefined) {
    if (!isFrequency(change.frequency)) return { message: "Choose how often it repeats." };
    set.frequency = change.frequency;
  }
  if (change.pausedUntil !== undefined) {
    if (change.pausedUntil !== null && !isDay(change.pausedUntil)) return { message: "Enter the day it starts again." };
    set.pausedUntil = change.pausedUntil;
  }
  if (change.stop) set.isActive = false;
  await db.batch([asUser(access.user.id), db.update(memorizedInvoices).set(set).where(eq(memorizedInvoices.id, memorizedId))]);
  refresh();
  return {};
}

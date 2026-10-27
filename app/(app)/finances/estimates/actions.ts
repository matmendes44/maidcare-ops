"use server";

import { and, eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { priceLists, properties, quoteEvents, quotes } from "@/db/schema";
import { checkPermission } from "@/lib/auth/session";
import { asUser, pgError } from "@/lib/db-helpers";
import { getI18n } from "@/lib/i18n/server";
import type { Tr } from "@/lib/i18n/tr";
import { logError } from "@/lib/log";
import { checkContent } from "@/lib/quotes/content";
import { invoiceAcceptedQuote } from "@/lib/quotes/invoice";
import { validUntilFrom } from "@/lib/quotes/status";
import { todayISO } from "../../customers/options";
import { getPriceList, newQuoteToken, nextQuoteNumber } from "./data";
import { buildEstimate, checkPriceList, type EstimateInput } from "@/lib/quotes/pricing";

type Msg = { message?: string; ok?: string; errors?: Record<string, string> };
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const id = (s: string) => (/^\d{1,15}$/.test(s) ? Number(s) : null);

function parseContent(f: FormData, tr: Tr) {
  let raw: unknown = null;
  try {
    raw = JSON.parse(text(f, "content") || "null");
  } catch {
    return { content: null, errors: [tr("The estimate couldn't be read. Reload and try again.")] };
  }
  return checkContent(raw, tr);
}

async function parseQuote(f: FormData, tr: Tr) {
  const errors: Record<string, string> = {};
  const customerId = id(text(f, "customerId"));
  if (!customerId) errors.customerId = tr("Choose who it's for.");
  const propertyId = id(text(f, "propertyId"));
  if (customerId && propertyId) {
    const [p] = await db.select({ customerId: properties.customerId }).from(properties).where(eq(properties.id, propertyId));
    if (p?.customerId !== customerId) errors.propertyId = tr("That address isn't this customer's.");
  }
  const { content, errors: contentErrors } = parseContent(f, tr);
  if (contentErrors.length) errors.content = contentErrors.join(" ");
  return { customerId, propertyId, content, internalNotes: text(f, "internalNotes").slice(0, 2000) || null, errors };
}

export async function createQuote(_prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("quotes.manage");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  const v = await parseQuote(f, tr);
  if (Object.keys(v.errors).length) return { errors: v.errors };
  let newId = 0;
  // the next estimate number; if two are made at once, the second tries again
  for (let attempt = 0; attempt < 3 && !newId; attempt++) {
    try {
      const [{ nextval }] = (await db.execute<{ nextval: number }>(sql`select nextval(pg_get_serial_sequence('quotes', 'id'))::int as nextval`)).rows;
      await db.batch([
        asUser(access.user.id),
        db.insert(quotes).values({
          id: nextval,
          quoteNumber: await nextQuoteNumber(),
          customerId: v.customerId!,
          propertyId: v.propertyId,
          content: v.content!,
          // until it's sent; sending sets two weeks from that day
          validUntil: validUntilFrom(todayISO()),
          publicToken: newQuoteToken(),
          internalNotes: v.internalNotes,
          createdBy: access.user.id,
        }),
        db.insert(quoteEvents).values({ quoteId: nextval, kind: "created", createdBy: access.user.id }),
      ]);
      newId = nextval;
    } catch (err) {
      const pg = pgError(err);
      if (pg?.code === "23505" && pg.constraint === "quotes_quote_number_key") continue;
      logError("quote create failed", err);
      return { message: tr("Couldn't save the estimate. Please try again.") };
    }
  }
  if (!newId) return { message: tr("Couldn't save the estimate. Please try again.") };
  redirect(`/finances/estimates/${newId}?saved=created`);
}

// Accepted quotes are locked: the acceptance names the version it agreed
// to. Editing a sent quote makes a new version (the customer's page shows
// the new one and an older open page can't be accepted).
export async function updateQuote(quoteId: number, _prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("quotes.manage");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return { message: tr("This estimate no longer exists.") };
  if (q.status === "accepted") return { message: tr("Accepted estimates can't be changed. Duplicate it to make a new one.") };
  const v = await parseQuote(f, tr);
  if (Object.keys(v.errors).length) return { errors: v.errors };
  const bump = q.status !== "draft";
  await db.batch([
    asUser(access.user.id),
    db
      .update(quotes)
      .set({ customerId: v.customerId!, propertyId: v.propertyId, content: v.content!, internalNotes: v.internalNotes, version: bump ? q.version + 1 : q.version, updatedAt: sql`now()`, updatedBy: access.user.id })
      .where(eq(quotes.id, quoteId)),
    db.insert(quoteEvents).values({ quoteId, kind: "edited", detail: { version: bump ? q.version + 1 : q.version }, createdBy: access.user.id }),
  ]);
  redirect(`/finances/estimates/${quoteId}?saved=updated`);
}

// Called when the link is copied, texted or emailed: a draft becomes sent,
// good for two weeks from the first time it's sent.
export async function markSent(quoteId: number, via: string): Promise<{ message?: string }> {
  const access = await checkPermission("quotes.manage");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  const [q] = await db.select({ status: quotes.status, sentAt: quotes.sentAt }).from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return { message: tr("This estimate no longer exists.") };
  if (q.status !== "draft" && q.status !== "sent") return {};
  await db.batch([
    db.update(quotes).set({ status: "sent", sentAt: sql`coalesce(${quotes.sentAt}, now())`, ...(q.sentAt ? {} : { validUntil: validUntilFrom(todayISO()) }) }).where(and(eq(quotes.id, quoteId), sql`${quotes.status} in ('draft', 'sent')`)),
    db.insert(quoteEvents).values({ quoteId, kind: "sent", detail: { via: via.slice(0, 20) }, createdBy: access.user.id }),
  ]);
  refresh();
  return {};
}

async function simple(quoteId: number, change: "withdraw" | "reopen" | "reset"): Promise<{ message?: string }> {
  const access = await checkPermission("quotes.manage");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return { message: tr("This estimate no longer exists.") };
  if (q.status === "accepted") return { message: tr("Accepted estimates can't be changed.") };
  if (change === "withdraw") {
    await db.batch([db.update(quotes).set({ status: "withdrawn" }).where(eq(quotes.id, quoteId)), db.insert(quoteEvents).values({ quoteId, kind: "withdrawn", createdBy: access.user.id })]);
  } else if (change === "reopen") {
    // open again for two more weeks if it had run out
    const until = validUntilFrom(todayISO());
    await db.batch([
      db.update(quotes).set({ status: "sent", declinedAt: null, declineReason: null, validUntil: q.validUntil < todayISO() ? until : q.validUntil, sentAt: sql`coalesce(${quotes.sentAt}, now())` }).where(eq(quotes.id, quoteId)),
      db.insert(quoteEvents).values({ quoteId, kind: "reopened", createdBy: access.user.id }),
    ]);
  } else {
    await db.batch([db.update(quotes).set({ publicToken: newQuoteToken() }).where(eq(quotes.id, quoteId)), db.insert(quoteEvents).values({ quoteId, kind: "link_reset", createdBy: access.user.id })]);
  }
  refresh();
  return {};
}
export const withdrawQuote = async (quoteId: number) => simple(quoteId, "withdraw");
export const reopenQuote = async (quoteId: number) => simple(quoteId, "reopen");
export const resetQuoteLink = async (quoteId: number) => simple(quoteId, "reset");

export async function duplicateQuote(quoteId: number): Promise<{ message?: string }> {
  const access = await checkPermission("quotes.duplicate");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return { message: tr("This estimate no longer exists.") };
  const [{ nextval }] = (await db.execute<{ nextval: number }>(sql`select nextval(pg_get_serial_sequence('quotes', 'id'))::int as nextval`)).rows;
  const until = validUntilFrom(todayISO());
  await db.batch([
    asUser(access.user.id),
    db.insert(quotes).values({ id: nextval, quoteNumber: await nextQuoteNumber(), customerId: q.customerId, propertyId: q.propertyId, content: q.content, validUntil: until, publicToken: newQuoteToken(), internalNotes: q.internalNotes, createdBy: access.user.id }),
    db.insert(quoteEvents).values({ quoteId: nextval, kind: "created", detail: { copiedFrom: q.quoteNumber }, createdBy: access.user.id }),
  ]);
  redirect(`/finances/estimates/${nextval}/edit`);
}

// Drafts never sent can be deleted; anything a customer may have seen stays.
export async function deleteDraftQuote(quoteId: number): Promise<{ message?: string }> {
  const access = await checkPermission("quotes.manage");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  const [q] = await db.select({ status: quotes.status, sentAt: quotes.sentAt }).from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return { message: tr("This estimate no longer exists.") };
  if (q.status !== "draft" || q.sentAt) return { message: tr("Only drafts that were never sent can be deleted. Withdraw it instead.") };
  await db.delete(quotes).where(eq(quotes.id, quoteId));
  redirect("/finances/estimates?deleted=1");
}

export async function retryQuoteInvoice(quoteId: number): Promise<{ message?: string }> {
  const access = await checkPermission("quotes.manage");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  await invoiceAcceptedQuote(quoteId);
  const [q] = await db.select({ invoiceError: quotes.invoiceError, invoiceId: quotes.invoiceId }).from(quotes).where(eq(quotes.id, quoteId));
  refresh();
  return q?.invoiceId && !q.invoiceError ? {} : { message: q?.invoiceError ? tr(q.invoiceError) : tr("Couldn't make the invoice.") };
}

// ---- price list and quick estimates ----
export async function savePriceList(_prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("priceList.manage");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  let raw: unknown;
  try {
    raw = JSON.parse(text(f, "list"));
  } catch {
    return { message: tr("The price list couldn't be read. Reload and try again.") };
  }
  const { list, errors } = checkPriceList(raw);
  if (errors.length) return { message: errors.slice(0, 4).join(" ") };
  await db.batch([
    asUser(access.user.id),
    db.insert(priceLists).values({ id: 1, content: list }).onConflictDoUpdate({ target: priceLists.id, set: { content: list } }),
  ]);
  refresh();
  return { ok: tr("Prices saved. New estimates use them; ones already made keep theirs.") };
}

// A quick estimate: the price list works out the prices and builds the
// estimate, which is saved as a draft to review (and fine-tune) before sending.
export async function createQuickQuote(_prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("quotes.manage");
  if (!access.user) return { message: access.denied };
  const { tr } = await getI18n();
  let input: EstimateInput;
  try {
    input = JSON.parse(text(f, "input"));
  } catch {
    return { message: tr("The estimate couldn't be read. Reload and try again.") };
  }
  const list = await getPriceList();
  const n = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : 0);
  const clean: EstimateInput = {
    bedrooms: n(input.bedrooms, 20),
    bathrooms: n(input.bathrooms, 30),
    halfBaths: n(input.halfBaths, 20),
    sqft: input.sqft ? n(input.sqft, 100_000) : null,
    levels: Array.isArray(input.levels) ? [...new Set(input.levels.filter((x): x is string => typeof x === "string"))].slice(0, 3) : [],
    frequencyId: typeof input.frequencyId === "string" && input.frequencyId ? input.frequencyId : null,
    extras: Array.isArray(input.extras) ? input.extras.slice(0, 40).map((e) => ({ id: String(e?.id ?? ""), units: n(e?.units, 100) || 1 })) : [],
  };
  const built = buildEstimate(list, clean);
  if (built.error) return { message: tr(built.error, built.errorVars) };
  // the rest is the same as any new estimate
  const data = new FormData();
  for (const k of ["customerId", "propertyId", "internalNotes"]) data.set(k, text(f, k));
  data.set("content", JSON.stringify(built.content));
  return createQuote({}, data);
}

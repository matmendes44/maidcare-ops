import "server-only";

import { and, asc, desc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/lib/db-helpers";
import { customers, invoices, properties, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { TIME_ZONE } from "@/lib/i18n/config";
import { stripe } from "@/lib/stripe";
import { displayName } from "../customers/options";
import { formatAddress } from "../properties/options";

export const PAGE_SIZE = 50;

export const tabs = ["all", "to_finalize", "draft", "open", "past_due", "paid"] as const;
export type Tab = (typeof tabs)[number];
export const statuses = ["draft", "open", "paid", "void", "uncollectible"] as const;
export type InvoiceStatus = (typeof statuses)[number];
export const sortKeys = ["created", "due", "total"] as const;
export type SortKey = (typeof sortKeys)[number];

export type InvoiceFilters = {
  tab: Tab;
  status: InvoiceStatus | null;
  createdFrom: string | null;
  createdTo: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  totalMin: number | null; // cents
  totalMax: number | null;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const dollars = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : null;
};

export function parseFilters(params: Record<string, string | string[] | undefined>): InvoiceFilters {
  const tab = one(params.tab) as Tab;
  const status = one(params.status) as InvoiceStatus;
  const sort = one(params.sort) as SortKey;
  const dir = one(params.dir);
  return {
    tab: tabs.includes(tab) ? tab : "all",
    status: statuses.includes(status) ? status : null,
    createdFrom: date(one(params.createdFrom)),
    createdTo: date(one(params.createdTo)),
    dueFrom: date(one(params.dueFrom)),
    dueTo: date(one(params.dueTo)),
    totalMin: dollars(one(params.totalMin)),
    totalMax: dollars(one(params.totalMax)),
    sort: sortKeys.includes(sort) ? sort : "created",
    dir: dir === "asc" ? "asc" : "desc",
    page: Math.max(1, Math.floor(Number(one(params.page))) || 1),
  };
}

// Stripe has no "past due" status: it's an open invoice whose due date passed.
const pastDue = sql`(${invoices.status} = 'open' and ${invoices.dueDate} < now())`;
// drafts for visits that are already done: the owner's list to finalize
const toFinalize = sql`(${invoices.status} = 'draft' and exists (select 1 from appointments a where a.id = ${outer(invoices.appointmentId)} and a.status = 'completed'))`;
const midnight = (day: string) => sql`(${day}::date::timestamp at time zone ${TIME_ZONE})`;
const nextMidnight = (day: string) => sql`((${day}::date + 1)::timestamp at time zone ${TIME_ZONE})`;

function tabCondition(tab: Tab): SQL | undefined {
  if (tab === "draft") return eq(invoices.status, "draft");
  if (tab === "to_finalize") return toFinalize;
  if (tab === "open") return eq(invoices.status, "open");
  if (tab === "paid") return eq(invoices.status, "paid");
  if (tab === "past_due") return pastDue;
  return undefined;
}

// The filters other than the tab, shared by the list and the tab counts.
function filterConditions(f: InvoiceFilters, customerId?: number) {
  return [
    customerId ? eq(invoices.customerId, customerId) : undefined,
    f.status ? eq(invoices.status, f.status) : undefined,
    f.createdFrom ? gte(invoices.createdAt, sql`${midnight(f.createdFrom)}`) : undefined,
    f.createdTo ? lt(invoices.createdAt, sql`${nextMidnight(f.createdTo)}`) : undefined,
    f.dueFrom ? gte(invoices.dueDate, sql`${midnight(f.dueFrom)}`) : undefined,
    f.dueTo ? lt(invoices.dueDate, sql`${nextMidnight(f.dueTo)}`) : undefined,
    f.totalMin !== null ? gte(invoices.totalCents, f.totalMin) : undefined,
    f.totalMax !== null ? lte(invoices.totalCents, f.totalMax) : undefined,
  ];
}

const sortColumns = { created: invoices.createdAt, due: invoices.dueDate, total: invoices.totalCents };

export async function getInvoices(f: InvoiceFilters, customerId?: number) {
  await requireUser();
  const where = and(tabCondition(f.tab), ...filterConditions(f, customerId));
  const order = f.dir === "asc" ? asc(sortColumns[f.sort]) : desc(sortColumns[f.sort]);

  const [rows, [counts], [{ lastSynced }]] = await Promise.all([
    db
      .select({
        id: invoices.id,
        stripeInvoiceId: invoices.stripeInvoiceId,
        number: invoices.number,
        status: invoices.status,
        isPastDue: sql<boolean>`${pastDue}`,
        stripeCustomerId: invoices.stripeCustomerId,
        customerName: invoices.customerName,
        customerEmail: invoices.customerEmail,
        totalCents: invoices.totalCents,
        amountDueCents: invoices.amountDueCents,
        amountPaidCents: invoices.amountPaidCents,
        amountRemainingCents: invoices.amountRemainingCents,
        createdAt: invoices.createdAt,
        dueDate: invoices.dueDate,
        paidAt: invoices.paidAt,
        paidVia: invoices.paidVia,
        paidViaNote: invoices.paidViaNote,
        hostedInvoiceUrl: invoices.hostedInvoiceUrl,
        invoicePdfUrl: invoices.invoicePdfUrl,
        customerId: customers.id,
        customerCode: customers.customerCode,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        propertyStreet: properties.street,
      })
      .from(invoices)
      .leftJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(properties, eq(properties.id, invoices.propertyId))
      .where(where)
      // drafts have no due date; keep them at the end of a due-date sort
      .orderBy(sql`${order} nulls last`, desc(invoices.id))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    // counts per tab under the same filters, plus the total for paging
    db
      .select({
        all: sql<number>`count(*)::int`,
        draft: sql<number>`count(*) filter (where ${invoices.status} = 'draft')::int`,
        to_finalize: sql<number>`count(*) filter (where ${toFinalize})::int`,
        open: sql<number>`count(*) filter (where ${invoices.status} = 'open')::int`,
        past_due: sql<number>`count(*) filter (where ${pastDue})::int`,
        paid: sql<number>`count(*) filter (where ${invoices.status} = 'paid')::int`,
        unlinked: sql<number>`count(*) filter (where ${invoices.customerId} is null)::int`,
      })
      .from(invoices)
      .where(and(...filterConditions(f, customerId))),
    db.select({ lastSynced: sql<string | null>`max(${invoices.syncedAt})` }).from(invoices),
  ]);
  return { rows, counts, lastSynced, total: counts[f.tab] };
}

// Customers and their properties, for the invoice form.
export async function getInvoiceFormOptions() {
  await requireUser();
  const [customerRows, propertyRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        customerCode: customers.customerCode,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
      })
      .from(customers)
      .orderBy(asc(customers.firstName), asc(customers.lastName)),
    db
      .select({
        id: properties.id,
        customerId: properties.customerId,
        street: properties.street,
        unit: properties.unit,
        city: properties.city,
        state: properties.state,
        zip: properties.zip,
        isActive: properties.isActive,
        isBilling: sql<boolean>`coalesce(${customers.billingPropertyId} = ${properties.id}, false)`,
      })
      .from(properties)
      .innerJoin(customers, eq(customers.id, properties.customerId))
      .orderBy(desc(properties.isActive), asc(properties.street)),
  ]);
  return {
    customers: customerRows.map((c) => ({ id: c.id, label: `${displayName(c)} (${c.customerCode})` })),
    properties: propertyRows.map((p) => ({
      id: p.id,
      customerId: p.customerId,
      isBilling: p.isBilling,
      label: formatAddress(p) + (p.isActive ? "" : " (inactive)"),
    })),
  };
}

// One invoice: our copy (with its customer and property) plus its line items
// read live from Stripe, so the page shows exactly what Stripe has.
export async function getInvoiceDetail(id: number) {
  await requireUser();
  const [row] = await db
    .select({
      invoice: invoices,
      isPastDue: sql<boolean>`${pastDue}`,
      customer: {
        id: customers.id,
        customerCode: customers.customerCode,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
      },
      property: properties,
      paidByName: users.name,
    })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(properties, eq(properties.id, invoices.propertyId))
    .leftJoin(users, eq(users.id, invoices.paidByUserId))
    .where(eq(invoices.id, id));
  if (!row) return null;
  const stripeInvoice = await stripe().invoices.retrieve(row.invoice.stripeInvoiceId);
  const listed = await stripe()
    .invoices.listLineItems(row.invoice.stripeInvoiceId, { limit: 100 })
    .autoPagingToArray({ limit: 500 });
  // Stripe lists lines newest first; put them in the order they were entered
  // (the position the app stores on each), oldest first for any without one
  const lines = listed
    .map((line, i) => ({ line, order: Number(line.metadata?.position ?? Number.NaN), fallback: listed.length - i }))
    .sort((a, b) => (Number.isNaN(a.order) ? a.fallback + 1e6 : a.order) - (Number.isNaN(b.order) ? b.fallback + 1e6 : b.order))
    .map(({ line }) => line);
  return { ...row, stripeInvoice, lines };
}

export type CardOnFile = { id: string; label: string; expires: string; isDefault: boolean; isExpired: boolean };

// The cards saved on a Stripe customer, their default first. Expired cards are
// listed but can't be charged.
export async function getCardsOnFile(stripeCustomerId: string): Promise<CardOnFile[]> {
  await requireUser();
  const [customer, methods] = await Promise.all([
    stripe().customers.retrieve(stripeCustomerId),
    stripe().customers.listPaymentMethods(stripeCustomerId, { type: "card", limit: 100 }),
  ]);
  if (customer.deleted) return [];
  const pick = customer.invoice_settings?.default_payment_method ?? customer.default_source;
  const defaultId = typeof pick === "string" ? pick : pick?.id;
  const now = new Date();
  const cards = methods.data.flatMap((pm) => {
    const c = pm.card;
    if (!c) return [];
    const brand = c.display_brand ?? c.brand;
    const label = `${brand.charAt(0).toUpperCase()}${brand.slice(1).replace(/_/g, " ")} •••• ${c.last4}`;
    // a card works through the last day of its expiry month
    const isExpired = new Date(c.exp_year, c.exp_month, 1) <= now;
    return [{ id: pm.id, label, expires: `${String(c.exp_month).padStart(2, "0")}/${String(c.exp_year).slice(-2)}`, isDefault: pm.id === defaultId, isExpired }];
  });
  return cards.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

export function parseInvoiceId(raw: string) {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

// A line item's service date ("YYYY-MM-DD"), if one was set: the date the app
// stored on it, else a period that falls within one Eastern calendar day
// (what Stripe prints as a single date). Lines without one still carry a
// default period (a single instant when they were created, close to the
// invoice's creation), so an instant within an hour of that is ignored.
export function serviceDateOf(line: { metadata?: Record<string, string> | null; period?: { start: number; end: number } | null }, invoiceCreated?: number) {
  const fromApp = line.metadata?.service_date;
  if (fromApp && /^\d{4}-\d{2}-\d{2}$/.test(fromApp)) return fromApp;
  const p = line.period;
  if (!p) return null;
  const day = (s: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(s * 1000));
  const isDefault = p.start === p.end && (invoiceCreated === undefined || Math.abs(p.start - invoiceCreated) <= 3600);
  if (!isDefault && day(p.start) === day(p.end)) return day(p.start);
  return null;
}

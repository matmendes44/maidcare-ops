import "server-only";

import { randomBytes } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contacts, customers, invoices, priceLists, properties, quoteAcceptances, quoteEvents, quotes, users, memorizedInvoices } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { checkContent, type QuoteContent } from "@/lib/quotes/content";
import { checkPriceList, defaultPriceList } from "@/lib/quotes/pricing";
import { displayName } from "../../customers/options";
import { formatAddress } from "../../properties/options";

export const newQuoteToken = () => randomBytes(32).toString("hex");
export const parseId = (raw: string) => (/^\d{1,15}$/.test(raw) ? Number(raw) : null);
// new numbers carry on from the estimates sent before the app (10489)
export const FIRST_QUOTE_NUMBER = 10490;

export async function nextQuoteNumber() {
  const [{ max }] = await db.select({ max: sql<number | null>`max(${quotes.quoteNumber})` }).from(quotes);
  return Math.max(FIRST_QUOTE_NUMBER, (max ?? 0) + 1);
}

const quoteColumns = {
  quote: quotes,
  customerCode: customers.customerCode,
  firstName: customers.firstName,
  lastName: customers.lastName,
  companyName: customers.companyName,
  customerStatus: customers.status,
};

export async function getQuotes() {
  await requireUser();
  const rows = await db
    .select(quoteColumns)
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .orderBy(desc(quotes.createdAt));
  const accepted = await db.select({ quoteId: quoteAcceptances.quoteId, totalCents: quoteAcceptances.totalCents, optionName: quoteAcceptances.optionName }).from(quoteAcceptances);
  return rows.map((r) => ({
    ...r.quote,
    content: checkContent(r.quote.content).content,
    customerName: displayName(r),
    customerCode: r.customerCode,
    customerStatus: r.customerStatus,
    acceptance: accepted.find((a) => a.quoteId === r.quote.id) ?? null,
  }));
}
export type QuoteRow = Awaited<ReturnType<typeof getQuotes>>[number];

// What the customer's page and the printout show for who it's for: name and
// service address (and phone/email only on the staff copy).
export async function partiesFor(customerId: number, propertyId: number | null) {
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
  const [property] = propertyId ? await db.select().from(properties).where(eq(properties.id, propertyId)) : [];
  const phones = (await db.select({ phone: contacts.phone, isPrimary: contacts.isPrimary }).from(contacts).where(eq(contacts.customerId, customerId)))
    .filter((c) => c.phone)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return {
    customer,
    name: customer ? displayName(customer) : "",
    address: property ? formatAddress(property) : null,
    phone: phones[0]?.phone ?? null,
    phones: phones.map((p) => p.phone!) as string[],
    email: customer?.email ?? null,
  };
}

export async function getQuote(id: number) {
  await requireUser();
  const [row] = await db
    .select({ ...quoteColumns, invoiceNumber: invoices.number, invoiceStatus: invoices.status })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .leftJoin(invoices, eq(invoices.id, quotes.invoiceId))
    .where(eq(quotes.id, id));
  if (!row) return null;
  const [events, [acceptance], parties, creator, [recurringInvoice]] = await Promise.all([
    db
      .select({ event: quoteEvents, byName: users.name })
      .from(quoteEvents)
      .leftJoin(users, eq(users.id, quoteEvents.createdBy))
      .where(eq(quoteEvents.quoteId, id))
      .orderBy(desc(quoteEvents.createdAt), desc(quoteEvents.id)),
    db.select().from(quoteAcceptances).where(eq(quoteAcceptances.quoteId, id)),
    partiesFor(row.quote.customerId, row.quote.propertyId),
    row.quote.createdBy ? db.select({ name: users.name }).from(users).where(eq(users.id, row.quote.createdBy)) : Promise.resolve([]),
    row.quote.recurringInvoiceId ? db.select({ number: invoices.number }).from(invoices).where(eq(invoices.id, row.quote.recurringInvoiceId)) : Promise.resolve([]),
  ]);
  // the memorized invoice its recurring plan became, if any
  const [memorized] = await db.select({ id: memorizedInvoices.id, frequency: memorizedInvoices.frequency, isActive: memorizedInvoices.isActive }).from(memorizedInvoices).where(eq(memorizedInvoices.sourceQuoteId, id));
  return {
    ...row.quote,
    content: checkContent(row.quote.content).content as QuoteContent,
    customerName: displayName(row),
    customerCode: row.customerCode,
    customerStatus: row.customerStatus,
    invoiceNumber: row.invoiceNumber,
    invoiceStatus: row.invoiceStatus,
    recurringInvoiceNumber: recurringInvoice?.number ?? null,
    memorized: memorized ?? null,
    events,
    acceptance: acceptance ?? null,
    parties,
    createdByName: creator[0]?.name ?? null,
  };
}
export type QuoteDetail = NonNullable<Awaited<ReturnType<typeof getQuote>>>;

// Customers and leads to quote, with their properties.
export async function quoteParties() {
  await requireUser();
  const { tr } = await getI18n();
  const [cs, ps] = await Promise.all([
    db
      .select({ id: customers.id, customerCode: customers.customerCode, firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName, status: customers.status })
      .from(customers)
      .orderBy(asc(customers.firstName)),
    db.select().from(properties).orderBy(desc(properties.isActive), asc(properties.street)),
  ]);
  return {
    customers: cs.filter((c) => c.status !== "inactive").map((c) => ({ id: c.id, label: `${displayName(c)} (${c.customerCode})${c.status === "lead" ? ` · ${tr("customer|Lead").toLowerCase()}` : ""}` })),
    properties: ps.map((p) => ({ id: p.id, customerId: p.customerId, label: formatAddress(p) + (p.isActive ? "" : ` (${tr("inactive")})`) })),
  };
}

// Accepted estimates with no visit booked yet (the sidebar badge).
export async function quotesToSchedule() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(quotes).where(sql`${quotes.status} = 'accepted' and ${quotes.appointmentId} is null`);
  return row.n;
}

// The price list for quick estimates: what's saved, else the defaults.
export async function getPriceList() {
  await requireUser();
  const [row] = await db.select().from(priceLists).where(eq(priceLists.id, 1));
  return { ...checkPriceList(row?.content ?? defaultPriceList).list, saved: Boolean(row), updatedAt: row?.updatedAt ?? row?.createdAt ?? null };
}

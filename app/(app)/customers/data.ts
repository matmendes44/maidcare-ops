import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { appointments, customers, payments, properties, vehicles } from "@/db/schema";
import { formatAddress } from "../properties/options";
import { displayName } from "./options";

// Options for the "Referred by" select. A customer can't refer themselves,
// so the one being edited is left out.
export async function getReferrerOptions(excludeId?: number) {
  await requireUser();
  const rows = await db
    .select({
      id: customers.id,
      customerCode: customers.customerCode,
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
    })
    .from(customers)
    .orderBy(asc(customers.firstName), asc(customers.lastName));

  return rows
    .filter((c) => c.id !== excludeId)
    .map((c) => ({ id: c.id, label: `${displayName(c)} (${c.customerCode})` }));
}

// Every customer, for choosing who a property belongs to.
export function getCustomerOptions() {
  return getReferrerOptions();
}

// A customer's properties, for choosing their billing address.
export async function getCustomerPropertyOptions(customerId: number) {
  await requireUser();
  const rows = await db
    .select()
    .from(properties)
    .where(eq(properties.customerId, customerId))
    .orderBy(desc(properties.isActive), asc(properties.street));
  const { t } = await getI18n();
  return rows.map((p) => ({
    id: p.id,
    label: formatAddress(p) + (p.isActive ? "" : ` (${t.customers.propertiesTable.inactive.toLowerCase()})`),
  }));
}

export async function getNextCustomerCode() {
  await requireUser();
  const [{ maxCode }] = await db
    .select({
      maxCode: sql<number | null>`max(substring(${customers.customerCode} from '^C(\\d+)$')::int)`,
    })
    .from(customers);
  return `C${(maxCode ?? 1000) + 1}`;
}

// Route params are untrusted strings; anything that isn't a positive integer
// can't be a customer id.
export function parseCustomerId(raw: string) {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function getCustomer(id: number) {
  await requireUser();
  return db.query.customers.findFirst({ where: eq(customers.id, id) });
}

export async function getCustomerDetail(id: number) {
  await requireUser();
  const [customer, recentVisits, [totals]] = await Promise.all([
    db.query.customers.findFirst({
      where: eq(customers.id, id),
      with: {
        customer: true, // referred by
        customers: { orderBy: asc(customers.firstName) }, // customers they referred
        contacts: true,
        properties: true,
        payments: { orderBy: desc(payments.paidAt), limit: 10 },
      },
    }),
    // by the customer each appointment was booked for, so history stays put
    // when a property changes hands
    db
      .select({
        id: appointments.id,
        scheduledStart: appointments.scheduledStart,
        scheduledEnd: appointments.scheduledEnd,
        status: appointments.status,
        priceCents: appointments.priceCents,
        street: properties.street,
        vehicleName: vehicles.name,
      })
      .from(appointments)
      .innerJoin(properties, eq(properties.id, appointments.propertyId))
      .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
      .where(eq(appointments.customerId, id))
      .orderBy(desc(appointments.scheduledStart))
      .limit(10),
    db
      .select({
        paidCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
        paymentCount: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(eq(payments.customerId, id)),
  ]);

  if (!customer) return null;
  return { ...customer, recentVisits, totals };
}

// Previous and next customer by code, in the same order as the list's code
// sort (length first, so C999 comes before C1000). Leads step through leads,
// customers through customers, matching the list they came from.
export async function getAdjacentCustomers(customerCode: string, lead: boolean) {
  await requireUser();
  const sameList = lead ? sql`${customers.status} = 'lead'` : sql`${customers.status} <> 'lead'`;
  const key = sql`(length(${customers.customerCode}), ${customers.customerCode})`;
  const current = sql`(length(${customerCode}), ${customerCode}::text)`;
  const [[prev], [next]] = await Promise.all([
    db
      .select({ id: customers.id })
      .from(customers)
      .where(sql`${key} < ${current} and ${sameList}`)
      .orderBy(sql`length(${customers.customerCode}) desc`, desc(customers.customerCode))
      .limit(1),
    db
      .select({ id: customers.id })
      .from(customers)
      .where(sql`${key} > ${current} and ${sameList}`)
      .orderBy(sql`length(${customers.customerCode})`, asc(customers.customerCode))
      .limit(1),
  ]);
  return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
}

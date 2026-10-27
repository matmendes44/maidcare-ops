import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/lib/db-helpers";
import {
  appointmentContractors,
  appointments,
  contractorDocuments,
  contractorPayRates,
  contractors,
  customers,
  expenses,
  properties,
  users,
  vendors,
} from "@/db/schema";
import { requirePermission, requireUser } from "@/lib/auth/session";
import { earnings, type PayRate, type WorkedVisit } from "@/lib/contractors/pay";
import { NEC_METHODS } from "@/lib/contractors/tax";
import { TIME_ZONE } from "@/lib/i18n/config";
import { displayName } from "../customers/options";
import { formatAddress } from "../properties/options";

const TZ = sql.raw(`'${TIME_ZONE}'`);
const localDay = sql<string>`to_char(${appointments.scheduledStart} at time zone ${TZ}, 'YYYY-MM-DD')`;

export function parseContractorId(raw: string) {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

// For the appointment form: names only, for anyone booking.
export async function getContractorChoices() {
  await requireUser();
  return db
    .select({ id: contractors.id, firstName: contractors.firstName, lastName: contractors.lastName, isActive: contractors.isActive })
    .from(contractors)
    .orderBy(desc(contractors.isActive), asc(contractors.firstName), asc(contractors.lastName));
}

async function ratesFor(ids: number[]) {
  if (!ids.length) return new Map<number, PayRate[]>();
  const rows = await db.select().from(contractorPayRates).where(inArray(contractorPayRates.contractorId, ids)).orderBy(asc(contractorPayRates.effectiveFrom));
  const map = new Map<number, PayRate[]>();
  for (const r of rows) map.set(r.contractorId, [...(map.get(r.contractorId) ?? []), r]);
  return map;
}

// Completed visits each contractor worked, with how many contractors were on
// each (for percent pay later).
async function visitsFor(ids: number[], span?: { from: string; to: string }) {
  if (!ids.length) return [];
  const crew = sql<number>`(select count(*)::int from ${appointmentContractors} ac2 where ac2.appointment_id = ${outer(appointments.id)})`;
  return db
    .select({
      contractorId: appointmentContractors.contractorId,
      appointmentId: appointments.id,
      day: localDay,
      priceCents: appointments.priceCents,
      contractorsOnVisit: crew,
      start: appointments.scheduledStart,
      end: appointments.scheduledEnd,
      customerId: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
      customerCode: customers.customerCode,
      property: properties,
    })
    .from(appointmentContractors)
    .innerJoin(appointments, eq(appointments.id, appointmentContractors.appointmentId))
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(properties, eq(properties.id, appointments.propertyId))
    .where(
      and(
        inArray(appointmentContractors.contractorId, ids),
        eq(appointments.status, "completed"),
        span ? sql`${localDay} between ${span.from} and ${span.to}` : undefined,
      ),
    )
    .orderBy(asc(appointments.scheduledStart));
}

// What's been paid to each contractor's vendor: all time, and per year split
// into what goes on the 1099-NEC and what doesn't (card / app payments).
async function paidFor(vendorIds: number[]) {
  if (!vendorIds.length) return [];
  return db
    .select({
      vendorId: expenses.vendorId,
      year: sql<number>`extract(year from ${expenses.expenseDate})::int`,
      reportable: sql<number>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.paymentMethod} in (${sql.join(NEC_METHODS.map((m) => sql`${m}`), sql`, `)})), 0)::float8`,
      excluded: sql<number>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.paymentMethod} not in (${sql.join(NEC_METHODS.map((m) => sql`${m}`), sql`, `)})), 0)::float8`,
      lastPaid: sql<string>`max(${expenses.expenseDate})`,
    })
    .from(expenses)
    .where(inArray(expenses.vendorId, vendorIds))
    .groupBy(expenses.vendorId, sql`2`);
}

export async function getContractors(today: string) {
  await requirePermission("contractors.view");
  const rows = await db
    .select({ contractor: contractors, vendorCode: vendors.vendorCode })
    .from(contractors)
    .innerJoin(vendors, eq(vendors.id, contractors.vendorId))
    .orderBy(desc(contractors.isActive), asc(contractors.firstName), asc(contractors.lastName));
  const ids = rows.map((r) => r.contractor.id);
  const [rates, visits, paid] = await Promise.all([ratesFor(ids), visitsFor(ids), paidFor(rows.map((r) => r.contractor.vendorId))]);
  const monthStart = `${today.slice(0, 7)}-01`;
  return rows.map(({ contractor: c, vendorCode }) => {
    const mine = visits.filter((v) => v.contractorId === c.id);
    const myRates = rates.get(c.id) ?? [];
    const all = earnings(mine, myRates);
    const month = earnings(mine.filter((v) => v.day >= monthStart), myRates);
    const paidRows = paid.filter((p) => p.vendorId === c.vendorId);
    const paidTotal = paidRows.reduce((s, p) => s + p.reportable + p.excluded, 0);
    return {
      ...c,
      vendorCode,
      rate: myRates.at(-1) ?? null,
      currentRate: myRates.filter((r) => r.effectiveFrom <= today).at(-1) ?? null,
      daysThisMonth: month.daysWorked,
      earnedThisMonth: month.totalCents,
      owed: all.totalCents - paidTotal,
      lastPaid: paidRows.map((p) => p.lastPaid).sort().at(-1) ?? null,
    };
  });
}

export async function getContractor(id: number) {
  await requirePermission("contractors.view");
  const creator = db.select({ id: users.id, name: users.name }).from(users).as("creator");
  const [row] = await db
    .select({ contractor: contractors, vendorCode: vendors.vendorCode, vendorName: vendors.name, createdByName: creator.name })
    .from(contractors)
    .innerJoin(vendors, eq(vendors.id, contractors.vendorId))
    .leftJoin(creator, eq(creator.id, contractors.createdBy))
    .where(eq(contractors.id, id));
  if (!row) return null;
  const setter = db.select({ id: users.id, name: users.name }).from(users).as("setter");
  const uploader = db.select({ id: users.id, name: users.name }).from(users).as("uploader");
  const [rates, allVisits, paid, documents] = await Promise.all([
    db
      .select({ rate: contractorPayRates, setByName: setter.name })
      .from(contractorPayRates)
      .leftJoin(setter, eq(setter.id, contractorPayRates.createdBy))
      .where(eq(contractorPayRates.contractorId, id))
      .orderBy(desc(contractorPayRates.effectiveFrom)),
    visitsFor([id]),
    paidFor([row.contractor.vendorId]),
    db
      .select({
        id: contractorDocuments.id,
        kind: contractorDocuments.kind,
        taxYear: contractorDocuments.taxYear,
        reportedCents: contractorDocuments.reportedCents,
        fileName: contractorDocuments.fileName,
        contentType: contractorDocuments.contentType,
        sizeBytes: contractorDocuments.sizeBytes,
        uploadedAt: contractorDocuments.uploadedAt,
        uploadedByName: uploader.name,
      })
      .from(contractorDocuments)
      .leftJoin(uploader, eq(uploader.id, contractorDocuments.uploadedBy))
      .where(eq(contractorDocuments.contractorId, id))
      .orderBy(desc(contractorDocuments.uploadedAt)),
  ]);
  const payRates = rates.map((r) => r.rate);
  const all = earnings(allVisits, [...payRates].reverse());
  const paidTotal = paid.reduce((s, p) => s + p.reportable + p.excluded, 0);
  return { ...row.contractor, vendorCode: row.vendorCode, vendorName: row.vendorName, createdByName: row.createdByName, rates, earnedTotal: all.totalCents, paidTotal, paidByYear: paid, documents, allVisits };
}
export type ContractorDetail = NonNullable<Awaited<ReturnType<typeof getContractor>>>;

// Visits and pay for a period, from the detail's already-loaded visits.
export function workIn(c: ContractorDetail, span: { from: string; to: string }) {
  const visits = c.allVisits.filter((v) => v.day >= span.from && v.day <= span.to);
  const result = earnings(visits as WorkedVisit[], c.rates.map((r) => r.rate).reverse());
  return {
    ...result,
    days: result.days.map((d) => ({
      ...d,
      visits: d.visits.map((v) => {
        const full = visits.find((x) => x.appointmentId === v.appointmentId)!;
        return { ...full, customerName: displayName(full), address: formatAddress(full.property) };
      }),
    })),
  };
}

// Completed visits in a period this contractor isn't on yet (to add past work).
export async function visitsToAssign(contractorId: number, span: { from: string; to: string }) {
  await requirePermission("contractors.manage");
  const crew = sql<string>`(select string_agg(c.first_name, ', ' order by c.first_name) from ${appointmentContractors} ac2 join ${contractors} c on c.id = ac2.contractor_id where ac2.appointment_id = ${outer(appointments.id)})`;
  const rows = await db
    .select({
      id: appointments.id,
      day: localDay,
      start: appointments.scheduledStart,
      end: appointments.scheduledEnd,
      priceCents: appointments.priceCents,
      crew,
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
      customerCode: customers.customerCode,
      property: properties,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(properties, eq(properties.id, appointments.propertyId))
    .where(
      and(
        eq(appointments.status, "completed"),
        sql`${localDay} between ${span.from} and ${span.to}`,
        sql`not exists (select 1 from ${appointmentContractors} ac where ac.appointment_id = ${outer(appointments.id)} and ac.contractor_id = ${contractorId})`,
      ),
    )
    .orderBy(asc(appointments.scheduledStart))
    .limit(500);
  return rows.map((r) => ({ ...r, customerName: displayName(r), address: formatAddress(r.property) }));
}

// Everyone's 1099 picture for a tax year.
export async function taxYearSummary(year: number) {
  await requirePermission("contractors.tax");
  const rows = await db
    .select({ contractor: contractors, vendorCode: vendors.vendorCode })
    .from(contractors)
    .innerJoin(vendors, eq(vendors.id, contractors.vendorId))
    .orderBy(asc(contractors.lastName), asc(contractors.firstName));
  const paid = (await paidFor(rows.map((r) => r.contractor.vendorId))).filter((p) => p.year === year);
  const filed = await db
    .select({ id: contractorDocuments.id, contractorId: contractorDocuments.contractorId, reportedCents: contractorDocuments.reportedCents, uploadedAt: contractorDocuments.uploadedAt })
    .from(contractorDocuments)
    .where(and(eq(contractorDocuments.kind, "1099_nec"), eq(contractorDocuments.taxYear, year)))
    .orderBy(desc(contractorDocuments.uploadedAt));
  return rows.map(({ contractor: c, vendorCode }) => {
    const p = paid.find((x) => x.vendorId === c.vendorId);
    const doc = filed.find((f) => f.contractorId === c.id) ?? null;
    return { ...c, vendorCode, reportableCents: p?.reportable ?? 0, excludedCents: p?.excluded ?? 0, filed: doc ? { id: doc.id, reportedCents: doc.reportedCents ?? 0 } : null };
  });
}

// What a contractor was paid in a year that goes on the 1099-NEC.
export async function reportableFor(vendorId: number, year: number) {
  const [row] = (await paidFor([vendorId])).filter((p) => p.year === year);
  return row?.reportable ?? 0;
}

// The appointments a contractor is on that overlap a time slot (two places
// at once).
export async function clashesFor(contractorIds: number[], start: ReturnType<typeof sql>, end: ReturnType<typeof sql>, selfId?: number) {
  if (!contractorIds.length) return [];
  return db
    .select({ contractorId: appointmentContractors.contractorId, firstName: contractors.firstName, start: appointments.scheduledStart, end: appointments.scheduledEnd })
    .from(appointmentContractors)
    .innerJoin(appointments, eq(appointments.id, appointmentContractors.appointmentId))
    .innerJoin(contractors, eq(contractors.id, appointmentContractors.contractorId))
    .where(
      and(
        inArray(appointmentContractors.contractorId, contractorIds),
        sql`${appointments.status} <> 'canceled'`,
        selfId ? sql`${appointments.id} <> ${selfId}` : undefined,
        sql`tstzrange(${appointments.scheduledStart}, ${appointments.scheduledEnd}) && tstzrange(${start}, ${end})`,
      ),
    )
    .limit(5);
}

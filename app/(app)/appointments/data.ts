import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { outer } from "@/lib/db-helpers";
import {
  appointments,
  auditLog,
  customers,
  payments,
  properties,
  users,
  vehicles,
  appointmentContractors,
  appointmentVehicles,
  contractors,
  invoices,
  memorizedInvoices,
} from "@/db/schema";
import { getContractorChoices } from "../contractors/data";
import { requireUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { displayName } from "../customers/options";
import { formatAddress } from "../properties/options";
import { TIME_ZONE, toLocalInputs } from "./options";

export function parseAppointmentId(raw: string) {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

// Midnight at the start of a calendar date in the business's time zone.
const localMidnight = (date: string) => sql`(${date}::date::timestamp at time zone ${TIME_ZONE})`;

const listColumns = {
  id: appointments.id,
  scheduledStart: appointments.scheduledStart,
  scheduledEnd: appointments.scheduledEnd,
  status: appointments.status,
  priceCents: appointments.priceCents,
  customerId: customers.id,
  customerCode: customers.customerCode,
  firstName: customers.firstName,
  lastName: customers.lastName,
  companyName: customers.companyName,
  street: properties.street,
  unit: properties.unit,
  city: properties.city,
  // every vehicle on the visit, lead one first ("Van 1, Van 2")
  vehicleName: sql<string | null>`coalesce((select string_agg(v.name, ', ' order by v.id = ${outer(appointments.vehicleId)} desc, v.name) from ${appointmentVehicles} av join ${vehicles} v on v.id = av.vehicle_id where av.appointment_id = ${outer(appointments.id)}), ${vehicles.name})`,
};

// Appointments from `from` up to (not including) `to`, both "YYYY-MM-DD".
export async function getAppointmentsBetween(from: string, to: string) {
  await requireUser();
  return db
    .select(listColumns)
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(properties, eq(properties.id, appointments.propertyId))
    .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .where(
      and(
        gte(appointments.scheduledStart, sql`${localMidnight(from)}`),
        lt(appointments.scheduledStart, sql`${localMidnight(to)}`),
      ),
    )
    .orderBy(asc(appointments.scheduledStart), asc(appointments.id));
}

export async function getCustomerAppointments(customerId: number, limit = 10) {
  await requireUser();
  return db
    .select(listColumns)
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(properties, eq(properties.id, appointments.propertyId))
    .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .where(eq(appointments.customerId, customerId))
    .orderBy(desc(appointments.scheduledStart))
    .limit(limit);
}

const createdBy = alias(users, "created_by_user");
const updatedBy = alias(users, "updated_by_user");

export async function getAppointment(id: number) {
  await requireUser();
  const [row] = await db
    .select({
      appointment: appointments,
      customer: {
        id: customers.id,
        customerCode: customers.customerCode,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
      },
      property: properties,
      vehicle: { id: vehicles.id, name: vehicles.name, plate: vehicles.plate },
      createdByName: createdBy.name,
      updatedByName: updatedBy.name,
      paidCents: sql<number>`(select coalesce(sum(${payments.amountCents}), 0)::int from ${payments} where ${outer(payments.appointmentId)} = ${outer(appointments.id)})`,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(properties, eq(properties.id, appointments.propertyId))
    .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .leftJoin(createdBy, eq(createdBy.id, appointments.createdBy))
    .leftJoin(updatedBy, eq(updatedBy.id, appointments.updatedBy))
    .where(eq(appointments.id, id));
  if (!row) return null;
  const crew = await db
    .select({ id: contractors.id, firstName: contractors.firstName, lastName: contractors.lastName })
    .from(appointmentContractors)
    .innerJoin(contractors, eq(contractors.id, appointmentContractors.contractorId))
    .where(eq(appointmentContractors.appointmentId, id))
    .orderBy(asc(contractors.firstName));
  const vehicleList = await db
    .select({ id: vehicles.id, name: vehicles.name, plate: vehicles.plate })
    .from(appointmentVehicles)
    .innerJoin(vehicles, eq(vehicles.id, appointmentVehicles.vehicleId))
    .where(eq(appointmentVehicles.appointmentId, id))
    .orderBy(sql`${vehicles.id} = ${row.appointment.vehicleId ?? 0} desc`, asc(vehicles.name));
  // older rows may only have the lead vehicle
  const allVehicles = vehicleList.length ? vehicleList : row.vehicle?.id ? [row.vehicle] : [];
  // the invoices billing this visit (its price is their total, voids aside)
  const billed = await db
    .select({ id: invoices.id, number: invoices.number, status: invoices.status, totalCents: invoices.totalCents })
    .from(invoices)
    .where(eq(invoices.appointmentId, id))
    .orderBy(asc(invoices.createdAt));
  return { ...row, contractors: crew, vehicles: allVehicles, invoices: billed };
}

// What's already booked on a day (not canceled), as the booking summary's
// day view shows it: local start and end times, who and with what.
export async function getDayAgenda(date: string) {
  await requireUser();
  const rows = await db
    .select({ ...listColumns, crew: sql<string | null>`(select string_agg(c.first_name, ', ' order by c.first_name) from ${appointmentContractors} ac join ${contractors} c on c.id = ac.contractor_id where ac.appointment_id = ${outer(appointments.id)})` })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(properties, eq(properties.id, appointments.propertyId))
    .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .where(and(gte(appointments.scheduledStart, sql`${localMidnight(date)}`), lt(appointments.scheduledStart, sql`${localMidnight(date)} + interval '1 day'`), sql`${appointments.status} <> 'canceled'`))
    .orderBy(asc(appointments.scheduledStart));
  return rows.map((r) => ({
    id: r.id,
    start: toLocalInputs(r.scheduledStart).time,
    end: toLocalInputs(r.scheduledEnd).time,
    customer: displayName(r),
    crew: r.crew,
    vehicles: r.vehicleName,
  }));
}

// How many visits (not canceled) fall on each day of a month: the dots on
// the booking calendar.
export async function getMonthBusy(monthStart: string) {
  await requireUser();
  const day = sql<string>`to_char(${appointments.scheduledStart} at time zone ${TIME_ZONE}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(gte(appointments.scheduledStart, sql`${localMidnight(monthStart)}`), lt(appointments.scheduledStart, sql`${localMidnight(monthStart)} + interval '1 month'`), sql`${appointments.status} <> 'canceled'`))
    // by position: the time zone is a parameter, so Postgres can't match the expressions
    .groupBy(sql`1`);
  return Object.fromEntries(rows.map((r) => [r.day, r.n])) as Record<string, number>;
}

// The audit trail, with the ids it mentions resolved to names so the history
// can say "Van 2" instead of "vehicle 3".
export async function getAppointmentHistory(id: number) {
  await requireUser();
  const entries = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      changedAt: auditLog.changedAt,
      changes: auditLog.changes,
      userName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.changedBy))
    .where(and(eq(auditLog.tableName, "appointments"), eq(auditLog.rowId, id)))
    .orderBy(desc(auditLog.changedAt), desc(auditLog.id));

  const ids = { vehicle_id: new Set<number>(), property_id: new Set<number>(), customer_id: new Set<number>() };
  for (const e of entries) {
    const changes = e.changes as Record<string, { from: unknown; to: unknown }>;
    for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
      for (const v of [changes[key]?.from, changes[key]?.to]) if (typeof v === "number") ids[key].add(v);
    }
  }
  const [vehicleRows, propertyRows, customerRows] = await Promise.all([
    ids.vehicle_id.size ? db.select({ id: vehicles.id, name: vehicles.name }).from(vehicles).where(inArray(vehicles.id, [...ids.vehicle_id])) : [],
    ids.property_id.size ? db.select().from(properties).where(inArray(properties.id, [...ids.property_id])) : [],
    ids.customer_id.size
      ? db.select({ id: customers.id, customerCode: customers.customerCode, firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName }).from(customers).where(inArray(customers.id, [...ids.customer_id]))
      : [],
  ]);
  const names: Record<string, Record<number, string>> = {
    vehicle_id: Object.fromEntries(vehicleRows.map((v) => [v.id, v.name])),
    property_id: Object.fromEntries(propertyRows.map((p) => [p.id, formatAddress(p)])),
    customer_id: Object.fromEntries(customerRows.map((c) => [c.id, `${displayName(c)} (${c.customerCode})`])),
  };
  return { entries, names };
}

// Everything the booking form needs to choose from.
export async function getBookingOptions() {
  await requireUser();
  const { t } = await getI18n();
  const [customerRows, propertyRows, vehicleRows] = await Promise.all([
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
        property: properties,
        isBilling: sql<boolean>`coalesce(${customers.billingPropertyId} = ${properties.id}, false)`,
      })
      .from(properties)
      .innerJoin(customers, eq(customers.id, properties.customerId))
      .orderBy(desc(properties.isActive), asc(properties.street)),
    db.select().from(vehicles).orderBy(desc(vehicles.isActive), asc(vehicles.name)),
  ]);
  const contractorRows = await getContractorChoices();
  // draft or open (finalized, unpaid) invoices not already billing an active
  // visit: a booking needs one of these on the customer's account
  const openInvoices = await db
    .select({ id: invoices.id, customerId: invoices.customerId, number: invoices.number, status: invoices.status, totalCents: invoices.totalCents, dueDate: invoices.dueDate, description: invoices.description })
    .from(invoices)
    .leftJoin(appointments, eq(appointments.id, invoices.appointmentId))
    .where(and(inArray(invoices.status, ["draft", "open"]), sql`${invoices.customerId} is not null`, sql`(${appointments.id} is null or ${appointments.status} = 'canceled')`))
    .orderBy(desc(invoices.createdAt));
  // customers' recurring (memorized) invoices: the default bill for a booking
  const recurring = await db
    .select({ id: memorizedInvoices.id, customerId: memorizedInvoices.customerId, propertyId: memorizedInvoices.propertyId, frequency: memorizedInvoices.frequency, totalCents: memorizedInvoices.totalCents })
    .from(memorizedInvoices)
    .where(eq(memorizedInvoices.isActive, true));
  return {
    recurring,
    invoices: openInvoices.map((i) => ({ id: i.id, customerId: i.customerId!, number: i.number ?? "Draft", isDraft: i.status === "draft", totalCents: i.totalCents, dueDate: i.dueDate, description: i.description })),
    contractors: contractorRows.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`, isActive: c.isActive })),
    customers: customerRows.map((c) => ({ id: c.id, label: `${displayName(c)} (${c.customerCode})` })),
    properties: propertyRows.map(({ property: p, isBilling }) => ({
      id: p.id,
      customerId: p.customerId,
      label: formatAddress(p) + (p.isActive ? "" : t.appointments.form.inactiveSuffix),
      isBilling,
    })),
    vehicles: vehicleRows.map((v) => ({
      id: v.id,
      label: v.name + (v.plate ? ` · ${v.plate}` : "") + (v.isActive ? "" : t.appointments.form.inactiveSuffix),
      isActive: v.isActive,
    })),
  };
}

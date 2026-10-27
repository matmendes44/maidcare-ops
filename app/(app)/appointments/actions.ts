"use server";

import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appointmentContractors, appointments, appointmentVehicles, contractors, gpsStops, invoices, memorizedInvoices, notifications, payments, properties, quoteEvents, quotes, vehicles } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { asUser, nextId, pgError } from "@/lib/db-helpers";
import { clashesFor } from "../contractors/data";
import { getDayAgenda, getMonthBusy } from "./data";
import { refreshVisitPrices } from "@/lib/stripe-invoices";
import { notifyToFinalize } from "@/lib/recurring/alerts";
import { detectVisitsFor } from "@/lib/fleet/sync";
import { canChangeAppointment } from "@/lib/appointments/access";
import { can } from "@/lib/auth/permissions";
import { today } from "@/lib/today";
import { draftFromMemorized } from "@/lib/recurring/draft";
import { stripe } from "@/lib/stripe";
import { getI18n } from "@/lib/i18n/server";
import type { Messages } from "@/lib/i18n/messages";
import type { Formatters } from "@/lib/i18n/format";
import { phrase, type Tr } from "@/lib/i18n/tr";
import { appointmentStatuses, TIME_ZONE, toLocalInputs, type AppointmentStatus } from "./options";
import { logError } from "@/lib/log";

export type AppointmentField =
  | "customerId"
  | "propertyId"
  | "vehicleIds"
  | "contractorIds"
  | "invoiceId"
  | "date"
  | "start"
  | "end"
  | "status"
  | "notes";

export type AppointmentFormState = {
  errors?: Partial<Record<AppointmentField, string>>;
  message?: string;
};

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// New appointments are always booked as pending; the status is changed
// afterwards (on its page or when editing).
function parse(formData: FormData, t: Messages, mode: "create" | "edit") {
  const e = t.appointments.errors;
  const text = (name: AppointmentField) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const id = (name: AppointmentField) => {
    const raw = text(name);
    return /^\d+$/.test(raw) ? Number(raw) : null;
  };
  const errors: NonNullable<AppointmentFormState["errors"]> = {};

  const customerId = id("customerId");
  if (customerId === null) errors.customerId = e.customer;
  const propertyId = id("propertyId");
  if (propertyId === null) errors.propertyId = e.property;
  // one or more vehicles; the first is the lead one GPS trips are matched to
  const vehicleIds = [...new Set(formData.getAll("vehicleIds").map(String).filter((x) => /^\d{1,15}$/.test(x)).map(Number))].slice(0, 10);
  if (vehicleIds.length === 0) errors.vehicleIds = phrase("Choose at least one vehicle.");
  // who's cleaning: at least one contractor
  const contractorIds = [...new Set(formData.getAll("contractorIds").map(String).filter((x) => /^\d{1,15}$/.test(x)).map(Number))].slice(0, 20);
  if (contractorIds.length === 0) errors.contractorIds = phrase("Choose who's cleaning.");

  const date = text("date");
  const start = text("start");
  const end = text("end");
  if (!isValidDate(date)) errors.date = e.date;
  if (!TIME_RE.test(start)) errors.start = e.start;
  if (!TIME_RE.test(end)) errors.end = e.end;
  // "HH:MM" strings compare correctly; appointments don't run past midnight
  else if (TIME_RE.test(start) && end <= start) errors.end = e.endBeforeStart;

  const status = (mode === "create" ? "pending" : text("status") || "pending") as AppointmentStatus;
  if (!appointmentStatuses.includes(status)) errors.status = e.status;

  return {
    values: {
      customerId: customerId!,
      propertyId: propertyId!,
      vehicleId: vehicleIds[0],
      // wall-clock times in the business's time zone, converted by Postgres
      // (which knows the daylight-saving rules)
      scheduledStart: sql`(${`${date} ${start}`}::timestamp at time zone ${TIME_ZONE})`,
      scheduledEnd: sql`(${`${date} ${end}`}::timestamp at time zone ${TIME_ZONE})`,
      status,
      notes: text("notes") || null,
      crewSize: contractorIds.length,
    },
    contractorIds,
    vehicleIds,
    errors,
    hasErrors: Object.keys(errors).length > 0,
  };
}

// Checks against the database that the form can't make: the property belongs
// to the customer, and the vehicles are in service. Skipped for values that
// haven't changed, so an old appointment stays editable after its property is
// transferred or a vehicle retired. A vehicle may be booked on visits that
// overlap: plans change on the day, and GPS records which vehicles really came.
async function checkReferences(
  { t }: { t: Messages },
  v: { customerId: number; propertyId: number },
  vehicleIds: number[],
  current?: { id: number; customerId: number; propertyId: number; vehicleIds: number[] },
) {
  const e = t.appointments.errors;
  const errors: NonNullable<AppointmentFormState["errors"]> = {};
  const [property, vehicleRows] = await Promise.all([
    db.query.properties.findFirst({ columns: { customerId: true }, where: eq(properties.id, v.propertyId) }),
    db.select({ id: vehicles.id, name: vehicles.name, isActive: vehicles.isActive }).from(vehicles).where(inArray(vehicles.id, vehicleIds)),
  ]);
  const placeChanged = !current || current.customerId !== v.customerId || current.propertyId !== v.propertyId;
  if (!property) errors.propertyId = e.propertyGone;
  else if (placeChanged && property.customerId !== v.customerId)
    errors.propertyId = e.propertyNotTheirs;
  if (vehicleRows.length !== vehicleIds.length) errors.vehicleIds = e.vehicleGone;
  else if (vehicleRows.some((r) => !r.isActive && !current?.vehicleIds.includes(r.id))) errors.vehicleIds = e.vehicleRetired;
  return errors;
}

// The chosen contractors exist, are active (unless already on this
// appointment), and aren't booked somewhere else at the same time.
async function checkContractors(
  { fmt, tr }: { fmt: Formatters; tr: Tr },
  ids: number[],
  slot: { start: ReturnType<typeof sql>; end: ReturnType<typeof sql> },
  selfId?: number,
): Promise<string | null> {
  const [rows, already] = await Promise.all([
    db.select({ id: contractors.id, isActive: contractors.isActive, firstName: contractors.firstName }).from(contractors).where(inArray(contractors.id, ids)),
    selfId ? db.select({ id: appointmentContractors.contractorId }).from(appointmentContractors).where(eq(appointmentContractors.appointmentId, selfId)) : Promise.resolve([]),
  ]);
  if (rows.length !== ids.length) return tr("A chosen contractor no longer exists. Choose again.");
  const inactive = rows.find((r) => !r.isActive && !already.some((a) => a.id === r.id));
  if (inactive) return tr("{name} is inactive. Choose someone else, or make them active on their page.", { name: inactive.firstName });
  const [clash] = await clashesFor(ids, slot.start, slot.end, selfId);
  if (clash) return tr("{name} is already booked {time}.", { name: clash.firstName, time: fmt.timeRange(clash.start, clash.end) });
  return null;
}

async function dbErrorState(i18n: { t: Messages }, err: unknown): Promise<AppointmentFormState> {
  const pg = pgError(err);
  if (pg?.code === "23514" && pg.constraint === "appointments_end_after_start_check")
    return { errors: { end: i18n.t.appointments.errors.endBeforeStart } };
  if (pg?.code === "23503") return { message: i18n.t.appointments.errors.referenceGone };
  logError("appointment save failed", err);
  return { message: i18n.t.appointments.errors.saveFailed };
}

export async function createAppointment(
  _prev: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const user = await requireUser();
  const i18n = await getI18n();
  const { values, contractorIds, vehicleIds, errors, hasErrors } = parse(formData, i18n.t, "create");
  if (hasErrors) return { errors };
  const refErrors = await checkReferences(i18n, values, vehicleIds);
  const crewError = await checkContractors(i18n, contractorIds, { start: values.scheduledStart, end: values.scheduledEnd });
  if (crewError) refErrors.contractorIds = crewError;
  if (Object.keys(refErrors).length > 0) return { errors: refErrors };

  // A booking needs a draft or open (finalized, unpaid) invoice on the
  // customer's account that isn't already billing another visit (staff make
  // drafts; the owner finalizes them). It becomes this visit's invoice, and
  // its total the visit's price. Billed to the customer's recurring invoice,
  // its draft is made now, when everything else has checked out (so an
  // abandoned booking leaves nothing behind).
  let invoiceRaw = String(formData.get("invoiceId") ?? "");
  let madeDraft: { id: number; stripeInvoiceId: string } | null = null;
  if (formData.get("billing") === "recurring") {
    const memorizedRaw = String(formData.get("memorizedId") ?? "");
    const [m] = /^\d{1,15}$/.test(memorizedRaw) ? await db.select().from(memorizedInvoices).where(eq(memorizedInvoices.id, Number(memorizedRaw))) : [];
    if (!m || !m.isActive || m.customerId !== values.customerId || (m.propertyId !== null && m.propertyId !== values.propertyId))
      return { errors: { invoiceId: phrase("This customer's recurring invoice changed. Reload, or bill this visit differently.") } };
    // one draft per booking (two visits on one day each get their own)
    const token = String(formData.get("token") ?? "");
    const made = await draftFromMemorized(m.id, String(formData.get("date")), user.id, /^[\w-]{16,64}$/.test(token) ? `maidcare-booking-${token}` : undefined);
    if ("error" in made) return { message: i18n.tr("Couldn't make the draft invoice: {error}", { error: i18n.tr(made.error) }) };
    madeDraft = made;
    invoiceRaw = String(made.id);
  }
  const [invoice] = /^\d{1,15}$/.test(invoiceRaw)
    ? await db
        .select({ id: invoices.id, customerId: invoices.customerId, status: invoices.status, totalCents: invoices.totalCents, appointmentId: invoices.appointmentId, usedBy: appointments.status })
        .from(invoices)
        .leftJoin(appointments, eq(appointments.id, invoices.appointmentId))
        .where(eq(invoices.id, Number(invoiceRaw)))
    : [];
  if (!invoice) return { errors: { invoiceId: phrase("Choose the invoice this visit is for.") } };
  if (invoice.customerId !== values.customerId) return { errors: { invoiceId: phrase("That invoice isn't on this customer's account.") } };
  if (invoice.status !== "open" && invoice.status !== "draft") return { errors: { invoiceId: phrase("Only a draft or open (unpaid) invoice can be used to book.") } };
  if (invoice.appointmentId && invoice.usedBy && invoice.usedBy !== "canceled") return { errors: { invoiceId: phrase("That invoice is already for another visit.") } };

  const quoteRaw = String(formData.get("quoteId") ?? "");
  const [quote] = /^\d{1,15}$/.test(quoteRaw) ? await db.select({ id: quotes.id, customerId: quotes.customerId, status: quotes.status }).from(quotes).where(eq(quotes.id, Number(quoteRaw))) : [];
  const quoteId = quote && quote.customerId === values.customerId && quote.status === "accepted" ? quote.id : null;
  let id: number;
  try {
    id = await nextId("appointments");
    await db.batch([
      asUser(user.id),
      db.insert(appointments).values({ ...values, id, priceCents: invoice.totalCents }),
      db.update(invoices).set({ appointmentId: id }).where(eq(invoices.id, invoice.id)),
      db.insert(appointmentContractors).values(contractorIds.map((contractorId) => ({ appointmentId: id, contractorId }))),
      db.insert(appointmentVehicles).values(vehicleIds.map((vehicleId) => ({ appointmentId: id, vehicleId }))),
      // booked from an accepted estimate: link it (only that customer's, once)
      ...(quoteId
        ? [
            db.update(quotes).set({ appointmentId: id }).where(and(eq(quotes.id, quoteId), eq(quotes.customerId, values.customerId), eq(quotes.status, "accepted"), isNull(quotes.appointmentId))),
            db.insert(quoteEvents).values({ quoteId, kind: "scheduled", detail: { appointmentId: id }, createdBy: user.id }),
          ]
        : []),
    ]);
  } catch (err) {
    // the draft made for this booking isn't needed after all
    if (madeDraft) {
      await stripe().invoices.del(madeDraft.stripeInvoiceId).catch((e) => logError("draft cleanup failed", e));
      await db.delete(invoices).where(eq(invoices.id, madeDraft.id));
    }
    return dbErrorState(i18n, err);
  }
  // a canceled visit the invoice moved from loses its price
  if (invoice.appointmentId) await refreshVisitPrices([invoice.appointmentId]);

  redirect(`/appointments/${id}?saved=created`);
}

// Whether a save keeps the scheduled times as they are (the form is to the minute).
const timesSame = (v: { scheduledStart: ReturnType<typeof sql>; scheduledEnd: ReturnType<typeof sql> }) =>
  sql`(date_trunc('minute', ${appointments.scheduledStart}) = ${v.scheduledStart} and date_trunc('minute', ${appointments.scheduledEnd}) = ${v.scheduledEnd})`;

export async function updateAppointment(
  id: number,
  _prev: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const user = await requireUser();
  const i18n = await getI18n();
  const { values, contractorIds, vehicleIds, errors, hasErrors } = parse(formData, i18n.t, "edit");
  if (hasErrors) return { errors };

  const current = await db.query.appointments.findFirst({
    columns: { customerId: true, propertyId: true, vehicleId: true, scheduledStart: true, status: true },
    where: eq(appointments.id, id),
  });
  if (!current) return { message: i18n.t.appointments.errors.gone };
  // past visits are view-only without appointments.editPast, and can't be moved into the past
  const day = await today();
  if (!canChangeAppointment(user, current.scheduledStart, day)) return { message: phrase("Past appointments can't be changed.") };
  if (!can(user, "appointments.editPast") && String(formData.get("date")) < day) return { errors: { date: phrase("Pick today or a later day.") } };
  // the status only changes with permission (else it stays as it was)
  if (!can(user, "appointments.complete")) values.status = current.status;

  // swapping the visit's invoice for another of the customer's (draft or
  // open, not billing another active visit)
  const swapRaw = String(formData.get("invoiceId") ?? "");
  const [swap] = /^\d{1,15}$/.test(swapRaw)
    ? await db
        .select({ id: invoices.id, customerId: invoices.customerId, status: invoices.status, appointmentId: invoices.appointmentId, usedBy: appointments.status })
        .from(invoices)
        .leftJoin(appointments, eq(appointments.id, invoices.appointmentId))
        .where(eq(invoices.id, Number(swapRaw)))
    : [];
  if (swapRaw && !swap) return { errors: { invoiceId: phrase("That invoice no longer exists.") } };
  if (swap && swap.appointmentId !== id) {
    if (swap.customerId !== values.customerId) return { errors: { invoiceId: phrase("That invoice isn't on this customer's account.") } };
    if (swap.status !== "draft" && swap.status !== "open") return { errors: { invoiceId: phrase("Only a draft or open (unpaid) invoice can be used.") } };
    if (swap.appointmentId && swap.usedBy && swap.usedBy !== "canceled") return { errors: { invoiceId: phrase("That invoice is already for another visit.") } };
  }
  const swapping = swap && swap.appointmentId !== id ? swap : null;
  const currentVehicles = (await db.select({ id: appointmentVehicles.vehicleId }).from(appointmentVehicles).where(eq(appointmentVehicles.appointmentId, id))).map((r) => r.id);
  const refErrors = await checkReferences(i18n, values, vehicleIds, { id, ...current, vehicleIds: [...currentVehicles, ...(current.vehicleId ? [current.vehicleId] : [])] });
  const crewError = await checkContractors(i18n, contractorIds, { start: values.scheduledStart, end: values.scheduledEnd }, id);
  if (crewError) refErrors.contractorIds = crewError;
  if (Object.keys(refErrors).length > 0) return { errors: refErrors };


  try {
    await db.batch([
      asUser(user.id),
      db
        .update(appointments)
        .set({
          ...values,
          // New times typed in: a new booking (GPS may still move it on the
          // day), or, once the crew has arrived, times entered by hand that
          // GPS leaves alone from now on.
          bookedStart: sql`case when ${timesSame(values)} then ${appointments.bookedStart} end`,
          bookedEnd: sql`case when ${timesSame(values)} then ${appointments.bookedEnd} end`,
          actualSource: sql`case when not ${timesSame(values)} and ${appointments.actualArrival} is not null and ${appointments.actualSource} in ('gps', 'gps_simulated') then 'manual' else ${appointments.actualSource} end`,
        })
        .where(eq(appointments.id, id)),
      db.delete(appointmentContractors).where(and(eq(appointmentContractors.appointmentId, id), notInArray(appointmentContractors.contractorId, contractorIds))),
      db.insert(appointmentContractors).values(contractorIds.map((contractorId) => ({ appointmentId: id, contractorId }))).onConflictDoNothing(),
      db.delete(appointmentVehicles).where(and(eq(appointmentVehicles.appointmentId, id), notInArray(appointmentVehicles.vehicleId, vehicleIds))),
      db.insert(appointmentVehicles).values(vehicleIds.map((vehicleId) => ({ appointmentId: id, vehicleId }))).onConflictDoNothing(),
      // the new invoice replaces its unpaid one(s); paid or void ones stay as history
      ...(swapping
        ? [
            db.update(invoices).set({ appointmentId: null }).where(and(eq(invoices.appointmentId, id), inArray(invoices.status, ["draft", "open"]))),
            db.update(invoices).set({ appointmentId: id }).where(eq(invoices.id, swapping.id)),
          ]
        : []),
    ]);
  } catch (err) {
    return dbErrorState(i18n, err);
  }
  if (swapping) await refreshVisitPrices([id, swapping.appointmentId]);

  redirect(`/appointments/${id}?saved=updated`);
}

export type StatusActionState = { message?: string };

// The Complete / Cancel / Reopen buttons on an appointment.
export async function setAppointmentStatus(
  id: number,
  status: AppointmentStatus,
): Promise<StatusActionState> {
  const user = await requireUser();
  const { t, tr } = await getI18n();
  if (!appointmentStatuses.includes(status)) return { message: t.appointments.status.unknown };
  // completing and reopening need their own permission; canceling, a visit
  // that can still be changed (today on, unless allowed to change past ones)
  if (status !== "canceled" && !can(user, "appointments.complete")) return { message: tr("You don't have permission to mark appointments completed or reopen them.") };
  if (status === "canceled") {
    const [cur] = await db.select({ start: appointments.scheduledStart }).from(appointments).where(eq(appointments.id, id));
    if (cur && !canChangeAppointment(user, cur.start, await today())) return { message: tr("Past appointments can't be canceled.") };
  }
  // a completed visit has to say who cleaned it: that's what pays them
  if (status === "completed") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(appointmentContractors).where(eq(appointmentContractors.appointmentId, id));
    if (n === 0) return { message: tr("Add who cleaned (Edit → Contractors) before marking it completed.") };
  }

  try {
    await db.batch([
      asUser(user.id),
      db.update(appointments).set({ status }).where(eq(appointments.id, id)),
    ]);
  } catch (err) {
    logError("appointment status change failed", err);
    return { message: t.appointments.status.failed };
  }

  if (status === "completed") {
    // its vehicles become the ones GPS saw there
    await detectVisitsFor(id).catch((err) => logError("visit detection failed", err));
    // done but not billed for real yet: tell the owner to finalize its invoice
    await notifyToFinalize().catch((err) => logError("finalize alert failed", err));
  }
  redirect(`/appointments/${id}?saved=${status}`);
}

export type DeleteActionState = { message?: string };

// Permanently removes an appointment. The audit log keeps a copy of the row
// and who deleted it. Appointments with payments can't be deleted: the
// payment would lose its link, so cancel those instead.
export async function deleteAppointment(id: number): Promise<DeleteActionState> {
  const user = await requireUser();
  const { t, tr } = await getI18n();
  if (!can(user, "appointments.delete")) return { message: tr("You don't have permission to delete appointments.") };
  const current = await db.query.appointments.findFirst({
    columns: { scheduledStart: true },
    where: eq(appointments.id, id),
  });
  if (!current) return { message: t.appointments.remove.gone };

  const [{ paymentCount }] = await db
    .select({ paymentCount: sql<number>`count(*)::int` })
    .from(payments)
    .where(eq(payments.appointmentId, id));
  if (paymentCount > 0)
    return { message: t.appointments.remove.hasPayments(paymentCount) };

  try {
    await db.batch([
      asUser(user.id),
      // GPS stops matched to it just lose the match
      db.update(gpsStops).set({ appointmentId: null }).where(eq(gpsStops.appointmentId, id)),
      // a "missed visit" alert about it would lead nowhere
      db.delete(notifications).where(and(eq(notifications.kind, "appointment_missed"), eq(notifications.href, `/appointments/${id}`))),
      db.delete(appointments).where(eq(appointments.id, id)),
    ]);
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23503")
      return { message: t.appointments.remove.referenced };
    logError("appointment delete failed", err);
    return { message: t.appointments.remove.failed };
  }

  redirect(`/appointments?view=week&date=${toLocalInputs(current.scheduledStart).date}&deleted=1`);
}

// For the booking form: what's on a day, and which days of a month are busy.
export async function dayAgenda(date: string) {
  await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidDate(date)) return [];
  return getDayAgenda(date);
}
export async function monthBusy(monthStart: string) {
  await requireUser();
  if (!/^\d{4}-\d{2}-01$/.test(monthStart) || !isValidDate(monthStart)) return {};
  return getMonthBusy(monthStart);
}

"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appointmentContractors, appointments, contractorDocuments, contractorPayRates, contractorTaxIds, contractors, vendors } from "@/db/schema";
import { auditEntry } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/auth/crypto";
import { can } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/session";
import { confirmFreshCode } from "@/lib/auth/step-up";
import { tinProblem, formatTin, taxClassifications, type TaxClassification } from "@/lib/contractors/tax";
import { asUser, nextId, pgError } from "@/lib/db-helpers";
import { logError } from "@/lib/log";
import { MAX_RECEIPT_BYTES, toReceipt } from "@/lib/receipts";
import { todayISO } from "../customers/options";
import { parseCents } from "../finances/invoices/money";
import { nextVendorCode } from "../finances/vendors/code";
import { reportableFor } from "./data";
import { vendorNameFor, type ContractorField } from "./options";

export type ContractorFormState = { errors?: Partial<Record<ContractorField, string>>; message?: string };

// tax IDs are encrypted with their own key (derived from AUTH_SECRET)
const TIN_PURPOSE = "contractor-tin";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const text = (formData: FormData, k: string) => String(formData.get(k) ?? "").trim();

function parse(formData: FormData, { withTax, creating }: { withTax: boolean; creating: boolean }) {
  const errors: NonNullable<ContractorFormState["errors"]> = {};
  const v = Object.fromEntries(
    ["firstName", "lastName", "businessName", "email", "phone", "street", "city", "state", "zip", "taxClassification", "w9ReceivedOn", "startDate", "isActive", "notes", "tinType", "tin", "dayRate"].map((k) => [k, text(formData, k)]),
  ) as Record<ContractorField, string>;
  if (!v.firstName) errors.firstName = "Enter their legal first name.";
  if (!v.lastName) errors.lastName = "Enter their legal last name.";
  for (const k of ["firstName", "lastName", "businessName", "phone", "street", "city"] as const) if (v[k].length > 120) errors[k] = "That's too long.";
  if (v.email && !EMAIL_RE.test(v.email)) errors.email = "That email address doesn't look right.";
  const state = v.state.toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) errors.state = "Use the 2-letter state code, like MD.";
  if (v.zip && !/^\d{5}(-\d{4})?$/.test(v.zip)) errors.zip = "Enter a 5-digit ZIP code.";
  if (v.startDate && !isDay(v.startDate)) errors.startDate = "That date doesn't look right.";

  let dayRateCents: number | null = null;
  if (creating && v.dayRate) {
    dayRateCents = parseCents(v.dayRate);
    if (dayRateCents === null || dayRateCents <= 0 || dayRateCents > 1_000_000) errors.dayRate = "Enter a day rate like 150.";
  }

  // tax details only from people allowed to see them
  let tin: { type: "ssn" | "ein"; digits: string } | null = null;
  const tax: { taxClassification?: TaxClassification | null; w9ReceivedOn?: string | null } = {};
  if (withTax) {
    if (v.taxClassification && !(v.taxClassification in taxClassifications)) errors.taxClassification = "Pick one from the list.";
    tax.taxClassification = (v.taxClassification || null) as TaxClassification | null;
    if (v.w9ReceivedOn && !isDay(v.w9ReceivedOn)) errors.w9ReceivedOn = "That date doesn't look right.";
    tax.w9ReceivedOn = v.w9ReceivedOn || null;
    const digits = v.tin.replace(/[\s-]/g, "");
    // blank keeps the number on file
    if (digits) {
      const type = v.tinType === "ein" ? "ein" : "ssn";
      const problem = tinProblem(type, digits);
      if (problem) errors.tin = problem;
      else tin = { type, digits };
    }
  }

  const data = {
    firstName: v.firstName,
    lastName: v.lastName,
    businessName: v.businessName || null,
    email: v.email.toLowerCase() || null,
    phone: v.phone || null,
    street: v.street || null,
    city: v.city || null,
    state: state || null,
    zip: v.zip || null,
    startDate: v.startDate || null,
    isActive: v.isActive !== "false",
    notes: v.notes.slice(0, 5000) || null,
    ...tax,
  };
  return { data, tin, dayRateCents, errors, hasErrors: Object.keys(errors).length > 0 };
}

export async function createContractor(_prev: ContractorFormState, formData: FormData): Promise<ContractorFormState> {
  const access = await checkPermission("contractors.manage");
  if (!access.user) return { message: access.denied };
  const withTax = can(access.user, "contractors.tax");
  const { data, tin, dayRateCents, errors, hasErrors } = parse(formData, { withTax, creating: true });
  if (hasErrors) return { errors };
  let id: number;
  try {
    id = await nextId("contractors");
    const vendorId = await nextId("vendors");
    await db.batch([
      asUser(access.user.id),
      // their payments are expenses to this vendor, under contract labor
      db.insert(vendors).values({ id: vendorId, vendorCode: await nextVendorCode(), name: vendorNameFor(data), defaultCategory: "contractors", email: data.email, phone: data.phone }),
      db.insert(contractors).values({ ...data, id, vendorId, tinType: tin?.type ?? null, tinLast4: tin?.digits.slice(-4) ?? null }),
      ...(tin ? [db.insert(contractorTaxIds).values({ contractorId: id, tinEncrypted: encrypt(tin.digits, TIN_PURPOSE), updatedBy: access.user.id }), auditEntry(access.user.id, "contractor_tax_ids", id, "insert", { tin: "added" })] : []),
      ...(dayRateCents ? [db.insert(contractorPayRates).values({ contractorId: id, effectiveFrom: data.startDate ?? todayISO(), payType: "day_rate", dayRateCents })] : []),
    ]);
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23505" && pg.constraint === "vendors_name_key") return { errors: { lastName: "There's already a vendor with this name. Add a business name or a middle initial to tell them apart." } };
    if (pg?.code === "23505" && pg.constraint === "vendors_vendor_code_key") return { message: "Someone added a vendor at the same moment. Please save again." };
    logError("contractor create failed", err);
    return { message: "Couldn't save the contractor. Please try again." };
  }
  redirect(`/contractors/${id}?saved=created`);
}

export async function updateContractor(id: number, _prev: ContractorFormState, formData: FormData): Promise<ContractorFormState> {
  const access = await checkPermission("contractors.manage");
  if (!access.user) return { message: access.denied };
  const withTax = can(access.user, "contractors.tax");
  const { data, tin, errors, hasErrors } = parse(formData, { withTax, creating: false });
  if (hasErrors) return { errors };
  const [current] = await db.select({ vendorId: contractors.vendorId }).from(contractors).where(eq(contractors.id, id));
  if (!current) return { message: "This contractor no longer exists." };
  try {
    await db.batch([
      asUser(access.user.id),
      db.update(contractors).set({ ...data, ...(tin ? { tinType: tin.type, tinLast4: tin.digits.slice(-4) } : {}) }).where(eq(contractors.id, id)),
      db.update(vendors).set({ name: vendorNameFor(data), isActive: data.isActive }).where(eq(vendors.id, current.vendorId)),
      ...(tin
        ? [
            db
              .insert(contractorTaxIds)
              .values({ contractorId: id, tinEncrypted: encrypt(tin.digits, TIN_PURPOSE), updatedBy: access.user.id })
              .onConflictDoUpdate({ target: contractorTaxIds.contractorId, set: { tinEncrypted: encrypt(tin.digits, TIN_PURPOSE), updatedBy: access.user.id, updatedAt: sql`now()` } }),
            auditEntry(access.user.id, "contractor_tax_ids", id, "update", { tin: "changed" }),
          ]
        : []),
    ]);
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23505" && pg.constraint === "vendors_name_key") return { errors: { lastName: "There's already a vendor with this name." } };
    logError("contractor update failed", err);
    return { message: "Couldn't save the changes. Please try again." };
  }
  redirect(`/contractors/${id}?saved=updated`);
}

// A new day rate from a date on. Days already worked before that date keep
// their rate; a rate set for the same date replaces it.
export async function setDayRate(id: number, _prev: { message?: string; ok?: string }, formData: FormData): Promise<{ message?: string; ok?: string }> {
  const access = await checkPermission("contractors.manage");
  if (!access.user) return { message: access.denied };
  const cents = parseCents(text(formData, "dayRate"));
  if (cents === null || cents <= 0 || cents > 1_000_000) return { message: "Enter a day rate like 150." };
  const from = text(formData, "effectiveFrom");
  if (!isDay(from)) return { message: "Enter the date the rate starts." };
  const note = text(formData, "note").slice(0, 200) || null;
  try {
    await db.batch([
      asUser(access.user.id),
      db
        .insert(contractorPayRates)
        .values({ contractorId: id, effectiveFrom: from, payType: "day_rate", dayRateCents: cents, percentBp: null, note })
        .onConflictDoUpdate({ target: [contractorPayRates.contractorId, contractorPayRates.effectiveFrom], set: { payType: "day_rate", dayRateCents: cents, percentBp: null, note } }),
    ]);
  } catch (err) {
    logError("pay rate save failed", err);
    return { message: "Couldn't save the rate. Please try again." };
  }
  refresh();
  return { ok: "Day rate saved." };
}

export async function deletePayRate(contractorId: number, rateId: number): Promise<{ message?: string }> {
  const access = await checkPermission("contractors.manage");
  if (!access.user) return { message: access.denied };
  await db.batch([asUser(access.user.id), db.delete(contractorPayRates).where(and(eq(contractorPayRates.id, rateId), eq(contractorPayRates.contractorId, contractorId)))]);
  refresh();
  return {};
}

// The full tax ID, after a fresh authenticator code. Each look is logged.
export async function revealTin(id: number, _prev: { tin?: string; message?: string }, formData: FormData): Promise<{ tin?: string; message?: string }> {
  const access = await checkPermission("contractors.tax");
  if (!access.user) return { message: access.denied };
  const problem = await confirmFreshCode(access.user, text(formData, "code"));
  if (problem) return { message: problem };
  const [row] = await db
    .select({ sealed: contractorTaxIds.tinEncrypted, type: contractors.tinType })
    .from(contractorTaxIds)
    .innerJoin(contractors, eq(contractors.id, contractorTaxIds.contractorId))
    .where(eq(contractorTaxIds.contractorId, id));
  if (!row) return { message: "No tax ID is on file." };
  await auditEntry(access.user.id, "contractor_tax_ids", id, "view", { tin: "viewed" });
  return { tin: formatTin(row.type, decrypt(row.sealed, TIN_PURPOSE)) };
}

// W-9s, filed 1099s and other papers. A filed 1099 keeps the amount paid that
// year at upload, so later changes to that year's payments are flagged.
export async function uploadDocument(id: number, _prev: { message?: string; ok?: string }, formData: FormData): Promise<{ message?: string; ok?: string }> {
  const access = await checkPermission("contractors.tax");
  if (!access.user) return { message: access.denied };
  const kind = text(formData, "kind");
  if (kind !== "w9" && kind !== "1099_nec" && kind !== "other") return { message: "Pick what the document is." };
  const yearRaw = text(formData, "taxYear");
  const taxYear = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
  if (kind === "1099_nec" && (!taxYear || taxYear < 2000 || taxYear > 2100)) return { message: "Pick the tax year of this 1099." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Pick a PDF or photo." };
  if (file.size > MAX_RECEIPT_BYTES) return { message: "That file is over 4 MB." };
  const doc = await toReceipt(Buffer.from(await file.arrayBuffer()), file.name);
  if (!doc) return { message: `${file.name} isn't a PDF or photo we can read.` };
  const [c] = await db.select({ vendorId: contractors.vendorId }).from(contractors).where(eq(contractors.id, id));
  if (!c) return { message: "This contractor no longer exists." };
  const reportedCents = kind === "1099_nec" ? await reportableFor(c.vendorId, taxYear!) : null;
  try {
    const docId = await nextId("contractor_documents");
    await db.batch([
      db.insert(contractorDocuments).values({ id: docId, contractorId: id, kind, taxYear: kind === "1099_nec" ? taxYear : null, reportedCents, ...doc, sizeBytes: doc.data.length, uploadedBy: access.user.id }),
      auditEntry(access.user.id, "contractor_documents", docId, "insert", { contractor_id: id, kind, tax_year: taxYear, file_name: doc.fileName }),
      // a W-9 upload counts as receiving it, unless a date is already set
      ...(kind === "w9" ? [db.update(contractors).set({ w9ReceivedOn: sql`coalesce(${contractors.w9ReceivedOn}, ${todayISO()}::date)` }).where(eq(contractors.id, id))] : []),
    ]);
  } catch (err) {
    logError("contractor document upload failed", err);
    return { message: "Couldn't save the document. Please try again." };
  }
  refresh();
  return { ok: "Document saved." };
}

export async function deleteDocument(contractorId: number, docId: number): Promise<{ message?: string }> {
  const access = await checkPermission("contractors.tax");
  if (!access.user) return { message: access.denied };
  const [doc] = await db.select({ kind: contractorDocuments.kind, fileName: contractorDocuments.fileName }).from(contractorDocuments).where(and(eq(contractorDocuments.id, docId), eq(contractorDocuments.contractorId, contractorId)));
  if (!doc) return { message: "That document no longer exists." };
  await db.batch([
    db.delete(contractorDocuments).where(eq(contractorDocuments.id, docId)),
    auditEntry(access.user.id, "contractor_documents", docId, "delete", { contractor_id: contractorId, kind: doc.kind, file_name: doc.fileName }),
  ]);
  refresh();
  return {};
}

// Adds a contractor to past completed visits (work done before the app
// tracked who cleaned).
export async function assignVisits(contractorId: number, _prev: { message?: string }, formData: FormData): Promise<{ message?: string }> {
  const access = await checkPermission("contractors.manage");
  if (!access.user) return { message: access.denied };
  const ids = formData
    .getAll("appointmentId")
    .map(String)
    .filter((s) => /^\d{1,15}$/.test(s))
    .map(Number)
    .slice(0, 500);
  if (!ids.length) return { message: "Tick the visits they worked." };
  const valid = await db.select({ id: appointments.id }).from(appointments).where(and(inArray(appointments.id, ids), eq(appointments.status, "completed")));
  if (!valid.length) return { message: "Those visits no longer exist." };
  await db.batch([
    asUser(access.user.id),
    db.insert(appointmentContractors).values(valid.map((a) => ({ appointmentId: a.id, contractorId }))).onConflictDoNothing(),
    // keep crew size in step with who's on each visit
    db.execute(sql`update appointments a set crew_size = (select count(*) from appointment_contractors ac where ac.appointment_id = a.id) where a.id in ${valid.map((a) => a.id)}`),
  ]);
  redirect(`/contractors/${contractorId}?saved=visits&n=${valid.length}`);
}

export async function removeFromVisit(contractorId: number, appointmentId: number): Promise<{ message?: string }> {
  const access = await checkPermission("contractors.manage");
  if (!access.user) return { message: access.denied };
  await db.batch([
    asUser(access.user.id),
    db.delete(appointmentContractors).where(and(eq(appointmentContractors.contractorId, contractorId), eq(appointmentContractors.appointmentId, appointmentId))),
    db.execute(sql`update appointments a set crew_size = (select count(*) from appointment_contractors ac where ac.appointment_id = a.id) where a.id = ${appointmentId}`),
  ]);
  refresh();
  return {};
}

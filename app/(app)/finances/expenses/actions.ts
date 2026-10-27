"use server";

import { and, eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { expenseReceipts, expenses, recurringExpenses, vendors } from "@/db/schema";
import { todayISO } from "@/app/(app)/customers/options";
import { can } from "@/lib/auth/permissions";
import { checkPermission, type SessionUser } from "@/lib/auth/session";
import { asUser, nextId, pgError, outer } from "@/lib/db-helpers";
import { canEditExpense } from "@/lib/expenses/access";
import { expenseChanges } from "@/lib/expenses/changes";
import { getI18n } from "@/lib/i18n/server";
import { phrase } from "@/lib/i18n/tr";
import { logError } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { MAX_RECEIPT_BYTES, MAX_RECEIPTS_PER_EXPENSE, toReceipt, type Receipt } from "@/lib/receipts";
import { nextVendorCode } from "../vendors/code";
import { findDuplicates } from "./data";
import { parseExpenseForm, parseScheduleForm } from "./parse";

export type ExpenseFormState = {
  errors?: Record<string, string>;
  message?: string;
  // a likely duplicate was found; the form asks before saving anyway
  duplicate?: string;
};

// The files picked in a form, checked and converted (photos re-encoded).
async function readReceipts(formData: FormData, already = 0): Promise<{ receipts: Receipt[]; error?: string }> {
  const { tr } = await getI18n();
  const files = formData.getAll("receipts").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length + already > MAX_RECEIPTS_PER_EXPENSE) return { receipts: [], error: tr("An expense can have up to {n} receipts.", { n: MAX_RECEIPTS_PER_EXPENSE }) };
  const receipts: Receipt[] = [];
  for (const file of files) {
    if (file.size > MAX_RECEIPT_BYTES) return { receipts: [], error: tr("{name} is over 4 MB. Use a smaller photo or PDF.", { name: file.name }) };
    const receipt = await toReceipt(Buffer.from(await file.arrayBuffer()), file.name);
    if (!receipt) return { receipts: [], error: tr("{name} isn't a photo or PDF we can read.", { name: file.name }) };
    receipts.push(receipt);
  }
  return { receipts };
}

// An existing vendor's id, or a new vendor (by name, unless one with that name
// exists) to insert in the same batch.
async function resolveVendor(vendorId: number | null, newVendorName: string | null) {
  if (vendorId !== null) {
    const [v] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId));
    return v ? { id: v.id, insert: null } : null;
  }
  const [existing] = await db.select({ id: vendors.id }).from(vendors).where(sql`lower(${vendors.name}) = lower(${newVendorName})`);
  if (existing) return { id: existing.id, insert: null };
  const id = await nextId("vendors");
  return { id, insert: { id, vendorCode: await nextVendorCode(), name: newVendorName! } };
}

async function vendorName(id: number) {
  const [v] = await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, id));
  return v?.name ?? "?";
}

// A payment can only belong to a recurring expense of the same vendor.
async function checkSchedule(scheduleId: number | null, vendorId: number) {
  if (scheduleId === null) return null;
  const [s] = await db.select({ vendorId: recurringExpenses.vendorId }).from(recurringExpenses).where(eq(recurringExpenses.id, scheduleId));
  if (!s) return phrase("That recurring expense no longer exists.");
  if (s.vendorId !== vendorId) return phrase("That recurring expense is for a different vendor. Untick it, or pick its vendor.");
  return null;
}

// The expense, if this person may change it (staff: only the ones they added).
async function editable(user: SessionUser, id: number) {
  const [row] = await db
    .select({ expense: expenses, vendorName: vendors.name })
    .from(expenses)
    .innerJoin(vendors, eq(vendors.id, expenses.vendorId))
    .where(eq(expenses.id, id));
  if (!row) return { error: phrase("This expense no longer exists.") };
  if (!canEditExpense(user, row.expense.createdBy)) return { error: phrase("You can only change expenses you added. Ask the owner.") };
  return { row };
}

const describe = (err: unknown, fallback: string) => {
  const pg = pgError(err);
  if (pg?.code === "23505" && pg.constraint?.startsWith("vendors_")) return phrase("Someone added a vendor at the same moment. Please save again.");
  if (pg?.code === "23503") return phrase("The vendor or recurring expense no longer exists. Pick another.");
  logError(fallback, err);
  return phrase("Couldn't save. Please try again.");
};

export async function createExpense(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const access = await checkPermission("expenses.create");
  if (!access.user) return { message: access.denied };
  const parsed = parseExpenseForm(formData, todayISO());
  const { errors, confirmedDuplicate } = parsed;
  // without expenses.manage, one-time expenses only
  const v = can(access.user, "expenses.manage") ? parsed.values : { ...parsed.values, repeats: null, recurringExpenseId: null };
  const { receipts, error: receiptError } = await readReceipts(formData);
  if (receiptError) errors.receipts = receiptError;
  if (Object.keys(errors).length) return { errors };

  const vendor = await resolveVendor(v.vendorId, v.newVendorName);
  if (!vendor) return { errors: { vendorId: phrase("That vendor no longer exists. Pick another.") } };
  const scheduleProblem = await checkSchedule(v.recurringExpenseId, vendor.id);
  if (scheduleProblem) return { message: scheduleProblem };
  if (!confirmedDuplicate && !vendor.insert) {
    const dupes = await findDuplicates(vendor.id, v.amountCents, v.expenseDate);
    if (dupes.length)
      return { duplicate: (await getI18n()).tr("There's already an expense from this vendor for this amount on {dates}. Save this one too?", { dates: dupes.map((d) => d.expenseDate).join(", ") }) };
  }

  let id: number;
  try {
    id = await nextId("expenses");
    // "Repeats" on a new expense starts a recurring schedule from it
    const scheduleId = v.repeats && v.recurringExpenseId === null ? await nextId("recurring_expenses") : null;
    const payment = { category: v.category, amountCents: v.amountCents, paymentMethod: v.paymentMethod, cardBrand: v.cardBrand, cardLast4: v.cardLast4, description: v.description };
    await db.batch([
      asUser(access.user.id),
      ...(vendor.insert ? [db.insert(vendors).values({ ...vendor.insert, defaultCategory: v.category })] : []),
      ...(scheduleId ? [db.insert(recurringExpenses).values({ id: scheduleId, vendorId: vendor.id, frequency: v.repeats!, startDate: v.expenseDate, ...payment })] : []),
      db.insert(expenses).values({ id, vendorId: vendor.id, expenseDate: v.expenseDate, reference: v.reference, recurringExpenseId: scheduleId ?? v.recurringExpenseId, ...payment }),
      ...receipts.map((r) => db.insert(expenseReceipts).values({ expenseId: id, ...r, sizeBytes: r.data.length, uploadedBy: access.user.id })),
    ]);
  } catch (err) {
    return { message: describe(err, "expense create failed") };
  }
  redirect(`/finances/expenses/${id}?saved=created`);
}

export async function updateExpense(id: number, _prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const access = await checkPermission("expenses.create");
  if (!access.user) return { message: access.denied };
  const current = await editable(access.user, id);
  if (current.error) return { message: current.error };
  const before = current.row!;
  const manage = can(access.user, "expenses.manage");
  const parsed = parseExpenseForm(formData, todayISO());
  const { errors, confirmedDuplicate } = parsed;
  // without expenses.manage, the recurring link stays as it was
  const v = manage ? parsed.values : { ...parsed.values, repeats: null, recurringExpenseId: before.expense.recurringExpenseId };
  if (Object.keys(errors).length) return { errors };
  const vendor = await resolveVendor(v.vendorId, v.newVendorName);
  if (!vendor) return { errors: { vendorId: phrase("That vendor no longer exists. Pick another.") } };
  const scheduleProblem = await checkSchedule(v.recurringExpenseId, vendor.id);
  if (scheduleProblem) return { message: scheduleProblem };
  if (!confirmedDuplicate && !vendor.insert) {
    const dupes = await findDuplicates(vendor.id, v.amountCents, v.expenseDate, id);
    if (dupes.length)
      return { duplicate: (await getI18n()).tr("There's another expense from this vendor for this amount on {dates}. Save anyway?", { dates: dupes.map((d) => d.expenseDate).join(", ") }) };
  }
  try {
    const scheduleId = v.repeats && v.recurringExpenseId === null ? await nextId("recurring_expenses") : null;
    const payment = { category: v.category, amountCents: v.amountCents, paymentMethod: v.paymentMethod, cardBrand: v.cardBrand, cardLast4: v.cardLast4, description: v.description };
    const results = await db.batch([
      asUser(access.user.id),
      ...(vendor.insert ? [db.insert(vendors).values({ ...vendor.insert, defaultCategory: v.category })] : []),
      ...(scheduleId ? [db.insert(recurringExpenses).values({ id: scheduleId, vendorId: vendor.id, frequency: v.repeats!, startDate: v.expenseDate, ...payment })] : []),
      db
        .update(expenses)
        .set({ vendorId: vendor.id, expenseDate: v.expenseDate, reference: v.reference, recurringExpenseId: scheduleId ?? v.recurringExpenseId, ...payment })
        .where(eq(expenses.id, id))
        .returning({ id: expenses.id }),
    ]);
    if ((results.at(-1) as { id: number }[]).length === 0) return { message: phrase("This expense no longer exists.") };
  } catch (err) {
    return { message: describe(err, "expense update failed") };
  }
  // staff edits are reported to the owner, with what changed
  if (!manage) {
    const changes = expenseChanges(
      { ...before.expense, vendorName: before.vendorName },
      { ...v, vendorName: v.newVendorName ?? (vendor.id === before.expense.vendorId ? before.vendorName : await vendorName(vendor.id)) },
    );
    if (changes.length)
      await notify({
        kind: "expense_edited",
        title: "{name} edited an expense: {vendor}, {date}",
        body: changes.join("; "),
        vars: { name: access.user.name, vendor: before.vendorName, date: before.expense.expenseDate },
        href: `/finances/expenses/${id}`,
        audience: "owner",
      }).catch((err) => logError("expense edit notification failed", err));
  }
  redirect(`/finances/expenses/${id}?saved=updated`);
}

export async function deleteExpense(id: number): Promise<{ message?: string }> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  try {
    await db.batch([asUser(access.user.id), db.delete(expenses).where(eq(expenses.id, id))]);
  } catch (err) {
    logError("expense delete failed", err);
    return { message: phrase("Couldn't delete the expense. Please try again.") };
  }
  redirect("/finances/expenses?tab=list&deleted=1");
}

export async function uploadReceipts(expenseId: number, _prev: { message?: string; ok?: string }, formData: FormData): Promise<{ message?: string; ok?: string }> {
  const access = await checkPermission("expenses.create");
  if (!access.user) return { message: access.denied };
  const current = await editable(access.user, expenseId);
  if (current.error) return { message: current.error };
  const [row] = await db
    .select({ id: expenses.id, n: sql<number>`(select count(*)::int from ${expenseReceipts} where ${outer(expenseReceipts.expenseId)} = ${outer(expenses.id)})` })
    .from(expenses)
    .where(eq(expenses.id, expenseId));
  if (!row) return { message: phrase("This expense no longer exists.") };
  const { receipts, error } = await readReceipts(formData, row.n);
  if (error) return { message: error };
  if (receipts.length === 0) return { message: phrase("Pick a photo or PDF first.") };
  try {
    await db.batch(receipts.map((r) => db.insert(expenseReceipts).values({ expenseId, ...r, sizeBytes: r.data.length, uploadedBy: access.user.id })) as [never, ...never[]]);
  } catch (err) {
    logError("receipt upload failed", err);
    return { message: phrase("Couldn't save the receipt. Please try again.") };
  }
  refresh();
  return { ok: receipts.length === 1 ? phrase("Receipt added.") : (await getI18n()).tr("{n} receipts added.", { n: receipts.length }) };
}

export async function deleteReceipt(receiptId: number): Promise<{ message?: string }> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  await db.delete(expenseReceipts).where(eq(expenseReceipts.id, receiptId));
  refresh();
  return {};
}

// ---- recurring expenses ----
export async function createSchedule(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  const { values: v, errors } = parseScheduleForm(formData);
  if (Object.keys(errors).length) return { errors };
  const vendor = await resolveVendor(v.vendorId, v.newVendorName);
  if (!vendor) return { errors: { vendorId: phrase("That vendor no longer exists. Pick another.") } };
  try {
    await db.batch([
      asUser(access.user.id),
      ...(vendor.insert ? [db.insert(vendors).values({ ...vendor.insert, defaultCategory: v.category })] : []),
      db.insert(recurringExpenses).values({
        vendorId: vendor.id,
        category: v.category,
        amountCents: v.amountCents,
        amountVaries: v.amountVaries,
        frequency: v.frequency,
        startDate: v.startDate,
        endDate: v.endDate,
        paymentMethod: v.paymentMethod,
        cardBrand: v.cardBrand,
        cardLast4: v.cardLast4,
        description: v.description,
      }),
    ]);
  } catch (err) {
    return { message: describe(err, "recurring expense create failed") };
  }
  redirect("/finances/expenses?tab=recurring&saved=schedule");
}

export async function updateSchedule(id: number, _prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  const { values: v, errors } = parseScheduleForm(formData);
  if (Object.keys(errors).length) return { errors };
  const vendor = await resolveVendor(v.vendorId, v.newVendorName);
  if (!vendor) return { errors: { vendorId: phrase("That vendor no longer exists. Pick another.") } };
  try {
    await db.batch([
      asUser(access.user.id),
      ...(vendor.insert ? [db.insert(vendors).values({ ...vendor.insert, defaultCategory: v.category })] : []),
      db
        .update(recurringExpenses)
        .set({
          vendorId: vendor.id,
          category: v.category,
          amountCents: v.amountCents,
          amountVaries: v.amountVaries,
          frequency: v.frequency,
          startDate: v.startDate,
          endDate: v.endDate,
          paymentMethod: v.paymentMethod,
          cardBrand: v.cardBrand,
          cardLast4: v.cardLast4,
          description: v.description,
        })
        .where(eq(recurringExpenses.id, id)),
    ]);
  } catch (err) {
    return { message: describe(err, "recurring expense update failed") };
  }
  redirect("/finances/expenses?tab=recurring&saved=schedule");
}

// Stops a recurring expense from today (cancelled subscription). Its past
// payments stay linked.
export async function endSchedule(id: number): Promise<{ message?: string }> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  const today = todayISO();
  await db.batch([
    asUser(access.user.id),
    db
      .update(recurringExpenses)
      .set({ endDate: sql`greatest(${recurringExpenses.startDate}, ${today}::date)` })
      .where(and(eq(recurringExpenses.id, id), sql`(${recurringExpenses.endDate} is null or ${recurringExpenses.endDate} > ${today}::date)`)),
  ]);
  refresh();
  return {};
}

// Only recurring expenses with no payments recorded can be deleted; the
// others are ended instead, so their history stays.
export async function deleteSchedule(id: number): Promise<{ message?: string }> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.recurringExpenseId, id));
  if (n > 0) return { message: `${n} ${n === 1 ? "payment is" : "payments are"} recorded for it, so it can't be deleted. End it instead.` };
  await db.batch([asUser(access.user.id), db.delete(recurringExpenses).where(eq(recurringExpenses.id, id))]);
  refresh();
  return {};
}

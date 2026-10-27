import "server-only";

import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/lib/db-helpers";
import { auditLog, expenseReceipts, expenses, inventoryAssets, inventoryItems, inventoryMovements, recurringExpenses, users, vendors } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { categoryKeys, paymentMethodKeys, type Category, type PaymentMethod } from "@/lib/expenses/options";
import { scheduleStatus, type ScheduleStatus } from "@/lib/expenses/recurring";
import { parseCents } from "../invoices/money";

export const PAGE_SIZE = 50;

export const expenseSorts = {
  date: { defaultDir: "desc", by: [sql`${expenses.expenseDate}`] },
  amount: { defaultDir: "desc", by: [sql`${expenses.amountCents}`] },
  vendor: { defaultDir: "asc", by: [sql`lower(${vendors.name})`] },
  category: { defaultDir: "asc", by: [sql`${expenses.category}`] },
} as const satisfies Record<string, { defaultDir: "asc" | "desc"; by: SQL[] }>;
export type ExpenseSort = keyof typeof expenseSorts;

export type ExpenseFilters = {
  q: string;
  category: Category | null;
  method: PaymentMethod | null;
  vendor: number | null;
  from: string | null;
  to: string | null;
  recurring: "yes" | "no" | null;
  receipt: "missing" | "has" | null;
  sort: ExpenseSort;
  dir: "asc" | "desc";
  page: number;
};

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function parseExpenseFilters(params: Record<string, string | string[] | undefined>): ExpenseFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const sort = one("sort") in expenseSorts ? (one("sort") as ExpenseSort) : "date";
  const dir = one("dir") === "asc" || one("dir") === "desc" ? (one("dir") as "asc" | "desc") : expenseSorts[sort].defaultDir;
  const vendor = /^\d{1,15}$/.test(one("vendor")) ? Number(one("vendor")) : null;
  const page = /^\d{1,5}$/.test(one("page")) ? Math.max(1, Number(one("page"))) : 1;
  return {
    q: one("q").slice(0, 100),
    category: categoryKeys.includes(one("category") as Category) ? (one("category") as Category) : null,
    method: paymentMethodKeys.includes(one("method") as PaymentMethod) ? (one("method") as PaymentMethod) : null,
    vendor,
    from: isDay(one("from")) ? one("from") : null,
    to: isDay(one("to")) ? one("to") : null,
    recurring: one("recurring") === "yes" || one("recurring") === "no" ? (one("recurring") as "yes" | "no") : null,
    receipt: one("receipt") === "missing" || one("receipt") === "has" ? (one("receipt") as "missing" | "has") : null,
    sort,
    dir,
    page,
  };
}

const receiptCount = sql<number>`(select count(*)::int from ${expenseReceipts} where ${outer(expenseReceipts.expenseId)} = ${outer(expenses.id)})`;

function where(f: Omit<ExpenseFilters, "sort" | "dir" | "page">) {
  const pattern = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
  return and(
    f.q
      ? or(
          ilike(vendors.name, pattern),
          ilike(vendors.vendorCode, pattern),
          ilike(expenses.description, pattern),
          ilike(expenses.reference, pattern),
          // amounts: "49.99" finds $49.99
          /^\$?[\d,]+(\.\d{1,2})?$/.test(f.q) && (parseCents(f.q) ?? 0) > 0 ? eq(expenses.amountCents, parseCents(f.q)!) : undefined,
        )
      : undefined,
    f.category ? eq(expenses.category, f.category) : undefined,
    f.method ? eq(expenses.paymentMethod, f.method) : undefined,
    f.vendor ? eq(expenses.vendorId, f.vendor) : undefined,
    f.from ? gte(expenses.expenseDate, f.from) : undefined,
    f.to ? lte(expenses.expenseDate, f.to) : undefined,
    f.recurring === "yes" ? isNotNull(expenses.recurringExpenseId) : f.recurring === "no" ? isNull(expenses.recurringExpenseId) : undefined,
    f.receipt === "missing" ? sql`${receiptCount} = 0` : f.receipt === "has" ? sql`${receiptCount} > 0` : undefined,
  );
}

const creator = () => db.select({ id: users.id, name: users.name }).from(users).as("creator");

// One page of expenses (or all of them, for exports), with the total of
// everything that matches.
export async function getExpenses(f: ExpenseFilters, { all = false } = {}) {
  await requirePermission("expenses.view");
  const c = creator();
  const direction = f.dir === "asc" ? sql`asc` : sql`desc`;
  const cond = where(f);
  const query = db
    .select({
      expense: expenses,
      vendorCode: vendors.vendorCode,
      vendorName: vendors.name,
      receipts: receiptCount,
      createdByName: c.name,
      frequency: recurringExpenses.frequency,
    })
    .from(expenses)
    .innerJoin(vendors, eq(vendors.id, expenses.vendorId))
    .leftJoin(c, eq(c.id, expenses.createdBy))
    .leftJoin(recurringExpenses, eq(recurringExpenses.id, expenses.recurringExpenseId))
    .where(cond)
    .orderBy(...expenseSorts[f.sort].by.map((e) => sql`${e} ${direction}`), desc(expenses.id));
  const [rows, [{ total, sum }]] = await Promise.all([
    all ? query : query.limit(PAGE_SIZE).offset((f.page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::float8` })
      .from(expenses)
      .innerJoin(vendors, eq(vendors.id, expenses.vendorId))
      .where(cond),
  ]);
  return { rows, total, sum };
}
export type ExpenseRow = Awaited<ReturnType<typeof getExpenses>>["rows"][number];

export function parseExpenseId(raw: string) {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

export async function getExpense(id: number) {
  await requirePermission("expenses.view");
  const c = creator();
  const editor = db.select({ id: users.id, name: users.name }).from(users).as("editor");
  const [row] = await db
    .select({ expense: expenses, vendor: vendors, createdByName: c.name, updatedByName: editor.name, schedule: recurringExpenses })
    .from(expenses)
    .innerJoin(vendors, eq(vendors.id, expenses.vendorId))
    .leftJoin(c, eq(c.id, expenses.createdBy))
    .leftJoin(editor, eq(editor.id, expenses.updatedBy))
    .leftJoin(recurringExpenses, eq(recurringExpenses.id, expenses.recurringExpenseId))
    .where(eq(expenses.id, id));
  if (!row) return null;
  const uploader = db.select({ id: users.id, name: users.name }).from(users).as("uploader");
  const receipts = await db
    .select({
      id: expenseReceipts.id,
      fileName: expenseReceipts.fileName,
      contentType: expenseReceipts.contentType,
      sizeBytes: expenseReceipts.sizeBytes,
      uploadedAt: expenseReceipts.uploadedAt,
      uploadedByName: uploader.name,
    })
    .from(expenseReceipts)
    .leftJoin(uploader, eq(uploader.id, expenseReceipts.uploadedBy))
    .where(eq(expenseReceipts.expenseId, id))
    .orderBy(asc(expenseReceipts.id));
  return { ...row, receipts };
}

// Other expenses from the same vendor for the same amount a few days either
// side: likely the same purchase entered twice.
export async function findDuplicates(vendorId: number, amountCents: number, day: string, excludeId?: number) {
  return db
    .select({ id: expenses.id, expenseDate: expenses.expenseDate })
    .from(expenses)
    .where(
      and(
        eq(expenses.vendorId, vendorId),
        eq(expenses.amountCents, amountCents),
        sql`abs(${expenses.expenseDate} - ${day}::date) <= 3`,
        excludeId ? sql`${expenses.id} <> ${excludeId}` : undefined,
      ),
    )
    .limit(3);
}

// ---- totals for the overview ----
type Span = { from: string; to: string };
const inSpan = (r: Span) => and(gte(expenses.expenseDate, r.from), lte(expenses.expenseDate, r.to));

export async function spendTotal(r: Span) {
  await requirePermission("expenses.view");
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::float8`, count: sql<number>`count(*)::int`, missing: sql<number>`count(*) filter (where ${receiptCount} = 0)::int` })
    .from(expenses)
    .where(inSpan(r));
  return row;
}

export async function spendByMonth(r: Span) {
  await requirePermission("expenses.view");
  return db
    .select({
      month: sql<string>`to_char(${expenses.expenseDate}, 'YYYY-MM')`,
      cents: sql<number>`sum(${expenses.amountCents})::float8`,
      recurring: sql<number>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.recurringExpenseId} is not null), 0)::float8`,
    })
    .from(expenses)
    .where(inSpan(r))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

export async function spendByCategory(r: Span) {
  await requirePermission("expenses.view");
  return db
    .select({ category: expenses.category, cents: sql<number>`sum(${expenses.amountCents})::float8`, count: sql<number>`count(*)::int` })
    .from(expenses)
    .where(inSpan(r))
    .groupBy(expenses.category)
    .orderBy(sql`2 desc`);
}

export async function spendByMethod(r: Span) {
  await requirePermission("expenses.view");
  return db
    .select({
      paymentMethod: expenses.paymentMethod,
      cardBrand: expenses.cardBrand,
      cardLast4: expenses.cardLast4,
      cents: sql<number>`sum(${expenses.amountCents})::float8`,
    })
    .from(expenses)
    .where(inSpan(r))
    .groupBy(expenses.paymentMethod, expenses.cardBrand, expenses.cardLast4)
    .orderBy(sql`4 desc`);
}

export async function topVendors(r: Span, limit = 8) {
  await requirePermission("expenses.view");
  return db
    .select({ id: vendors.id, code: vendors.vendorCode, name: vendors.name, cents: sql<number>`sum(${expenses.amountCents})::float8`, count: sql<number>`count(*)::int` })
    .from(expenses)
    .innerJoin(vendors, eq(vendors.id, expenses.vendorId))
    .where(inSpan(r))
    .groupBy(vendors.id)
    .orderBy(sql`4 desc`)
    .limit(limit);
}

export async function spendByDay(r: Span) {
  await requirePermission("expenses.view");
  return db
    .select({ day: expenses.expenseDate, cents: sql<number>`sum(${expenses.amountCents})::float8` })
    .from(expenses)
    .where(inSpan(r))
    .groupBy(expenses.expenseDate)
    .orderBy(expenses.expenseDate);
}

// Average one-time (not recurring) spending per day, for projecting the rest
// of the month.
export async function oneTimePerDay(r: Span, days: number) {
  await requirePermission("expenses.view");
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::float8` })
    .from(expenses)
    .where(and(inSpan(r), isNull(expenses.recurringExpenseId)));
  return row.cents / Math.max(1, days);
}

// ---- recurring ----
export async function getSchedules(today: string) {
  await requirePermission("expenses.view");
  const [schedules, payments] = await Promise.all([
    db
      .select({ schedule: recurringExpenses, vendorCode: vendors.vendorCode, vendorName: vendors.name })
      .from(recurringExpenses)
      .innerJoin(vendors, eq(vendors.id, recurringExpenses.vendorId))
      .orderBy(asc(sql`lower(${vendors.name})`)),
    db
      .select({ scheduleId: expenses.recurringExpenseId, day: expenses.expenseDate, cents: expenses.amountCents })
      .from(expenses)
      .where(and(isNotNull(expenses.recurringExpenseId), sql`${expenses.expenseDate} >= ${today}::date - 800`))
      .orderBy(asc(expenses.expenseDate)),
  ]);
  return schedules.map(({ schedule, vendorCode, vendorName }) => {
    const mine = payments.filter((p) => p.scheduleId === schedule.id);
    const status: ScheduleStatus = scheduleStatus(schedule, mine.map((p) => p.day), today);
    const last = mine.at(-1) ?? null;
    return { ...schedule, vendorCode, vendorName, status, lastPaid: last, ended: schedule.endDate !== null && schedule.endDate < today };
  });
}
export type ScheduleRow = Awaited<ReturnType<typeof getSchedules>>[number];

export async function getSchedule(id: number) {
  await requirePermission("expenses.view");
  const [row] = await db
    .select({ schedule: recurringExpenses, vendorCode: vendors.vendorCode, vendorName: vendors.name })
    .from(recurringExpenses)
    .innerJoin(vendors, eq(vendors.id, recurringExpenses.vendorId))
    .where(eq(recurringExpenses.id, id));
  return row ?? null;
}

// How the last expense was paid, to start the next one the same way.
export async function lastPaymentUsed() {
  await requirePermission("expenses.view");
  const [row] = await db
    .select({ paymentMethod: expenses.paymentMethod, cardBrand: expenses.cardBrand, cardLast4: expenses.cardLast4 })
    .from(expenses)
    .orderBy(desc(expenses.createdAt))
    .limit(1);
  return row ?? { paymentMethod: "credit_card", cardBrand: null, cardLast4: null };
}

// The expense's change history from the audit log, newest first.
export async function expenseHistory(id: number) {
  await requirePermission("expenses.view");
  return db
    .select({ action: auditLog.action, changedAt: auditLog.changedAt, changes: auditLog.changes, name: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.changedBy))
    .where(and(eq(auditLog.tableName, "expenses"), eq(auditLog.rowId, id)))
    .orderBy(desc(auditLog.changedAt))
    .limit(50);
}

// Inventory this expense paid for: equipment bought with it, and stock
// received against it.
export async function inventoryFor(expenseId: number) {
  await requirePermission("expenses.view");
  const [assets, stock] = await Promise.all([
    db
      .select({ id: inventoryAssets.id, tag: inventoryAssets.assetTag, name: inventoryItems.name })
      .from(inventoryAssets)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryAssets.itemId))
      .where(eq(inventoryAssets.expenseId, expenseId)),
    db
      .select({ itemId: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit, quantity: sql<number>`sum(${inventoryMovements.quantity})::int` })
      .from(inventoryMovements)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
      .where(and(eq(inventoryMovements.expenseId, expenseId), eq(inventoryMovements.kind, "purchase")))
      .groupBy(inventoryItems.id),
  ]);
  return { assets, stock };
}

// Recurring expenses still going, for tying a payment to one on the form.
export async function scheduleChoices() {
  await requirePermission("expenses.view");
  return db
    .select({ id: recurringExpenses.id, vendorId: recurringExpenses.vendorId, vendorName: vendors.name, amountCents: recurringExpenses.amountCents, frequency: recurringExpenses.frequency })
    .from(recurringExpenses)
    .innerJoin(vendors, eq(vendors.id, recurringExpenses.vendorId))
    .where(sql`${recurringExpenses.endDate} is null or ${recurringExpenses.endDate} >= current_date`)
    .orderBy(asc(recurringExpenses.id));
}

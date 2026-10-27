import "server-only";

import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/lib/db-helpers";
import { contractors, expenses, recurringExpenses, users, vendors } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { todayISO } from "@/app/(app)/customers/options";
import { nextVendorCode } from "./code";

// The vendor ID a new vendor will get (shown on the form; the server assigns
// it when saving).
export async function getNextVendorCode() {
  await requirePermission("expenses.view");
  return nextVendorCode();
}

export function parseVendorId(raw: string) {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

// For vendor pickers: active vendors first, then by name.
export async function getVendorOptions() {
  await requirePermission("expenses.view");
  return db
    .select({
      id: vendors.id,
      code: vendors.vendorCode,
      name: vendors.name,
      defaultCategory: vendors.defaultCategory,
      isActive: vendors.isActive,
      isContractor: sql<boolean>`exists (select 1 from ${contractors} where ${outer(contractors.vendorId)} = ${outer(vendors.id)})`,
    })
    .from(vendors)
    .orderBy(desc(vendors.isActive), asc(sql`lower(${vendors.name})`));
}
export type VendorOption = Awaited<ReturnType<typeof getVendorOptions>>[number];

export const vendorSorts = {
  code: { defaultDir: "asc", by: [sql`length(${vendors.vendorCode})`, sql`${vendors.vendorCode}`] },
  name: { defaultDir: "asc", by: [sql`lower(${vendors.name})`] },
  category: { defaultDir: "asc", by: [sql`${vendors.defaultCategory}`] },
  year: { defaultDir: "desc", by: [sql`spent_year`] },
  total: { defaultDir: "desc", by: [sql`spent_total`] },
  last: { defaultDir: "desc", by: [sql`last_expense`] },
} as const satisfies Record<string, { defaultDir: "asc" | "desc"; by: SQL[] }>;
export type VendorSort = keyof typeof vendorSorts;

export function parseVendorParams(params: Record<string, string | string[] | undefined>) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const raw = one(params.sort);
  const sort: VendorSort = raw && raw in vendorSorts ? (raw as VendorSort) : "name";
  const rawDir = one(params.dir);
  const dir = rawDir === "asc" || rawDir === "desc" ? rawDir : vendorSorts[sort].defaultDir;
  return { sort, dir, q: one(params.q)?.trim().slice(0, 100) ?? "", inactive: one(params.inactive) === "1" };
}

export async function getVendors({ sort, dir, q, inactive }: ReturnType<typeof parseVendorParams>) {
  await requirePermission("expenses.view");
  const yearStart = `${todayISO().slice(0, 4)}-01-01`;
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const spent = db
    .select({
      vendorId: expenses.vendorId,
      spentYear: sql<number>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.expenseDate} >= ${yearStart}), 0)::bigint`.as("spent_year"),
      spentTotal: sql<number>`sum(${expenses.amountCents})::bigint`.as("spent_total"),
      count: sql<number>`count(*)::int`.as("expense_count"),
      lastExpense: sql<string>`max(${expenses.expenseDate})`.as("last_expense"),
    })
    .from(expenses)
    .groupBy(expenses.vendorId)
    .as("spent");
  const direction = dir === "asc" ? sql`asc` : sql`desc`;
  const rows = await db
    .select({
      vendor: vendors,
      spentYear: sql<number>`coalesce(${spent.spentYear}, 0)::float8`,
      spentTotal: sql<number>`coalesce(${spent.spentTotal}, 0)::float8`,
      count: sql<number>`coalesce(${spent.count}, 0)`,
      lastExpense: spent.lastExpense,
    })
    .from(vendors)
    .leftJoin(spent, eq(spent.vendorId, vendors.id))
    .where(
      and(
        inactive ? undefined : eq(vendors.isActive, true),
        q
          ? or(
              ilike(vendors.vendorCode, pattern),
              ilike(vendors.name, pattern),
              ilike(vendors.contactName, pattern),
              ilike(vendors.email, pattern),
              ilike(vendors.accountNumber, pattern),
              q.replace(/\D/g, "").length >= 3 ? sql`regexp_replace(coalesce(${vendors.phone}, ''), '\\D', '', 'g') like ${`%${q.replace(/\D/g, "")}%`}` : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(...vendorSorts[sort].by.map((e) => sql`${e} ${direction} nulls last`), vendors.id);
  const [{ inactiveCount }] = await db.select({ inactiveCount: sql<number>`count(*)::int` }).from(vendors).where(eq(vendors.isActive, false));
  return { rows, inactiveCount };
}

export async function getVendor(id: number) {
  await requirePermission("expenses.view");
  const creator = db.select({ id: users.id, name: users.name }).from(users).as("creator");
  const [row] = await db
    .select({ vendor: vendors, createdByName: creator.name })
    .from(vendors)
    .leftJoin(creator, eq(creator.id, vendors.createdBy))
    .where(eq(vendors.id, id));
  if (!row) return null;
  const year = Number(todayISO().slice(0, 4));
  const [totals] = await db
    .select({
      thisYear: sql<number>`coalesce(sum(${expenses.amountCents}) filter (where extract(year from ${expenses.expenseDate}) = ${year}), 0)::float8`,
      lastYear: sql<number>`coalesce(sum(${expenses.amountCents}) filter (where extract(year from ${expenses.expenseDate}) = ${year - 1}), 0)::float8`,
      allTime: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::float8`,
      count: sql<number>`count(*)::int`,
      last: sql<string | null>`max(${expenses.expenseDate})`,
    })
    .from(expenses)
    .where(eq(expenses.vendorId, id));
  const schedules = await db.select().from(recurringExpenses).where(eq(recurringExpenses.vendorId, id)).orderBy(desc(recurringExpenses.startDate));
  const [contractor] = await db.select({ id: contractors.id }).from(contractors).where(eq(contractors.vendorId, id));
  return { ...row.vendor, createdByName: row.createdByName, totals, schedules, contractorId: contractor?.id ?? null };
}

// Previous and next vendor by code, like the customer pages.
export async function getAdjacentVendors(code: string) {
  await requirePermission("expenses.view");
  const key = sql`(length(${vendors.vendorCode}), ${vendors.vendorCode})`;
  const current = sql`(length(${code}), ${code}::text)`;
  const [[prev], [next]] = await Promise.all([
    db.select({ id: vendors.id }).from(vendors).where(sql`${key} < ${current}`).orderBy(sql`length(${vendors.vendorCode}) desc`, desc(vendors.vendorCode)).limit(1),
    db.select({ id: vendors.id }).from(vendors).where(sql`${key} > ${current}`).orderBy(sql`length(${vendors.vendorCode})`, asc(vendors.vendorCode)).limit(1),
  ]);
  return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
}

import "server-only";

import { getTableName, sql, type Column } from "drizzle-orm";
import { db } from "@/db";

// Postgres errors arrive wrapped (DrizzleQueryError → NeonDbError); walk the
// cause chain to find the one carrying the SQLSTATE code.
export function pgError(err: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = err;
  while (current && typeof current === "object") {
    if ("code" in current && typeof current.code === "string") {
      return current as { code: string; constraint?: string };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

// Reserves an id from a table's sequence. The HTTP driver has no interactive
// transactions, so rows that reference each other are written in one
// db.batch() (a single transaction) with their ids reserved up front.
export async function nextId(table: "customers" | "properties" | "vendors" | "expenses" | "recurring_expenses" | "contractors" | "contractor_documents" | "appointments" | "inventory_items" | "inventory_assets" | "inventory_locations") {
  const { rows } = await db.execute<{ id: number }>(
    sql`select nextval(pg_get_serial_sequence(${table}, 'id'))::int as id`,
  );
  return rows[0].id;
}

// First statement of a db.batch() that changes audited tables: tells the
// database triggers who is making the change (app.user_id, transaction-local),
// so created_by / updated_by and the audit_log record the right user.
export function asUser(userId: number) {
  return db.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
}

// A column with its table's name ("vendors"."id"). Needed inside a subquery
// that refers to the outer query's table: in a query on a single table,
// drizzle writes bare column names, so `${vendors.id}` in
// "exists (select 1 from contractors where … = ${vendors.id})" would become
// "id" and match the subquery's own id column instead.
export function outer(column: Column) {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}

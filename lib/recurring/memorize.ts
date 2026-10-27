import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memorizedInvoices } from "@/db/schema";
import { asUser } from "@/lib/db-helpers";
import type { MemorizedLine } from "./draft";
import type { Frequency } from "./schedule";

// Makes this the customer's one active memorized invoice for that property
// (the one they had stops). Callers check permissions.
export async function replaceMemorized(
  userId: number | null,
  v: { customerId: number; propertyId: number | null; frequency: Frequency; lines: MemorizedLine[]; totalCents: number; source: "estimate" | "invoice"; sourceQuoteId?: number; sourceInvoiceId?: number },
) {
  const stop = db
    .update(memorizedInvoices)
    .set({ isActive: false })
    .where(and(eq(memorizedInvoices.customerId, v.customerId), eq(memorizedInvoices.isActive, true), sql`coalesce(${memorizedInvoices.propertyId}, 0) = ${v.propertyId ?? 0}`));
  const add = db.insert(memorizedInvoices).values({ ...v, createdBy: userId || null });
  if (userId) await db.batch([asUser(userId), stop, add]);
  else await db.batch([stop, add]);
}

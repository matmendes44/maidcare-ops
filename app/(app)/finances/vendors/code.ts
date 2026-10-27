import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";

// The next free vendor ID: V1000, V1001… Assigned by the server only; the
// unique constraint catches two vendors added at the same moment.
export async function nextVendorCode() {
  const [{ maxCode }] = await db
    .select({ maxCode: sql<number | null>`max(substring(${vendors.vendorCode} from '^V(\\d+)$')::int)` })
    .from(vendors);
  return `V${(maxCode ?? 999) + 1}`;
}

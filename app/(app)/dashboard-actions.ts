"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { normalizeLayout } from "@/lib/dashboard/layout";

// Saves how someone arranged their dashboard (null puts it back to the default).
export async function saveDashboardLayout(raw: unknown | null): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await db
    .update(users)
    .set({ dashboardLayout: raw === null ? null : normalizeLayout(raw) })
    .where(eq(users.id, user.id));
  return { ok: true };
}

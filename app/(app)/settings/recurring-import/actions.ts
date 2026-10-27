"use server";

import { redirect } from "next/navigation";
import { checkPermission } from "@/lib/auth/session";
import { applyImport } from "@/lib/recurring/import";
import { today } from "@/lib/today";

// Creates the memorized invoices the owner confirmed on the review page.
export async function runRecurringImport(planIds: number[]): Promise<{ message?: string }> {
  const access = await checkPermission("invoices.memorize");
  if (!access.user) return { message: access.denied };
  const ids = planIds.filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 2000);
  if (ids.length === 0) return { message: "Choose at least one customer." };
  const { created, skipped } = await applyImport(await today(), ids, access.user.id);
  redirect(`/settings/recurring-import?created=${created}&skipped=${skipped}`);
}

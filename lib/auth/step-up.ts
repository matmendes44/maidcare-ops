import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isRateLimited, recordFailedLogin } from "./rate-limit";
import { verifyCode } from "./totp";
import { markStepUsed, openSecret } from "./two-factor";
import type { SessionUser } from "./session";

// A fresh code from the authenticator app, for the most sensitive actions
// (seeing or exporting tax ID numbers), so an unlocked screen alone isn't
// enough. Each code works once; wrong codes count toward the code limit.
// Returns an error message, or null when the code is right.
export async function confirmFreshCode(user: SessionUser, code: string): Promise<string | null> {
  if (await isRateLimited(user.email, null, "code")) return "Too many attempts. Try again in 15 minutes.";
  const row = await db.query.users.findFirst({ columns: { totpSecret: true, totpLastStep: true }, where: eq(users.id, user.id) });
  if (!row?.totpSecret) return "Two-step login isn't set up for this account.";
  const step = verifyCode(openSecret(row.totpSecret), code.replace(/\s/g, ""), row.totpLastStep);
  if (step == null || !(await markStepUsed(user.id, step))) {
    await recordFailedLogin(user.email, null, "code");
    return "That code isn't right. Enter the current code from your authenticator app.";
  }
  return null;
}

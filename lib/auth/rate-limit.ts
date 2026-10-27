import "server-only";

import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

// Slowing down guessing without letting a stranger lock someone out.
//
// - Wrong passwords count per email *from the same address* (5 in 15
//   minutes), per address overall (20), and per email from anywhere (100 an
//   hour, a backstop against guessing spread over many machines). A stranger
//   who only knows your email can't lock you out from elsewhere; and a right
//   password still needs your two-step code.
// - Wrong two-step codes count per email (5 in 15 minutes). Only someone who
//   already has the password can make them, and five of them block that
//   email's sign-in for the window.
// - Re-entering your password in Settings has its own limit (5 in 15 minutes).
export type AttemptKind = "password" | "code" | "reauth";

const MINUTES_15 = sql`now() - interval '15 minutes'`;
const HOUR = sql`now() - interval '1 hour'`;

const count = (...conditions: Parameters<typeof and>) => db.$count(loginAttempts, and(...conditions));

export async function isRateLimited(email: string, ip: string | null, kind: AttemptKind = "password") {
  if (kind === "reauth") {
    return (await count(eq(loginAttempts.email, email), eq(loginAttempts.kind, "reauth"), gt(loginAttempts.attemptedAt, MINUTES_15))) >= 5;
  }
  const [codes, fromIp, emailFromIp, emailAnywhere] = await Promise.all([
    count(eq(loginAttempts.email, email), eq(loginAttempts.kind, "code"), gt(loginAttempts.attemptedAt, MINUTES_15)),
    ip ? count(eq(loginAttempts.ip, ip), gt(loginAttempts.attemptedAt, MINUTES_15)) : 0,
    count(
      eq(loginAttempts.email, email),
      eq(loginAttempts.kind, "password"),
      // without a known address (local development) count by email alone
      ip ? eq(loginAttempts.ip, ip) : undefined,
      gt(loginAttempts.attemptedAt, MINUTES_15),
    ),
    kind === "password" ? count(eq(loginAttempts.email, email), eq(loginAttempts.kind, "password"), gt(loginAttempts.attemptedAt, HOUR)) : 0,
  ]);
  if (codes >= 5 || fromIp >= 20) return true;
  return kind === "password" && (emailFromIp >= 5 || emailAnywhere >= 100);
}

export async function recordFailedLogin(email: string, ip: string | null, kind: AttemptKind = "password") {
  await db.insert(loginAttempts).values({ email, ip, kind });
  // keep the table small; anything outside the windows no longer matters
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, sql`now() - interval '1 day'`));
}

// After a complete sign-in (password and code).
export async function clearFailedLogins(email: string) {
  await db.delete(loginAttempts).where(and(eq(loginAttempts.email, email), inArray(loginAttempts.kind, ["password", "code"])));
}

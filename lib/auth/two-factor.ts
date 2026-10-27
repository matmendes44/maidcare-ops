import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { loginChallenges, userRecoveryCodes, users } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";

// The step between a correct password and a session (see login_challenges).
const CHALLENGE_COOKIE = "login_challenge";
const CHALLENGE_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
const SECRET_PURPOSE = "totp";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const sealSecret = (secret: string) => encrypt(secret, SECRET_PURPOSE);
export const openSecret = (sealed: string) => decrypt(sealed, SECRET_PURPOSE);

// Server Actions only (sets a cookie).
export async function startChallenge(userId: number, purpose: "verify" | "enroll", next: string, pendingSecret?: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + CHALLENGE_MINUTES * 60_000);
  // one challenge per user at a time; also clears out expired ones
  await db.delete(loginChallenges).where(sql`${loginChallenges.userId} = ${userId} or ${loginChallenges.expiresAt} < now()`);
  await db.insert(loginChallenges).values({
    id: sha256(token),
    userId,
    purpose,
    next,
    pendingSecret: pendingSecret ? sealSecret(pendingSecret) : null,
    expiresAt: expires.toISOString(),
  });
  (await cookies()).set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/login",
    expires,
  });
}

// This browser's challenge and its user, if it's still valid.
export async function currentChallenge() {
  const token = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ challenge: loginChallenges, user: { id: users.id, email: users.email, name: users.name, isDisabled: users.isDisabled, totpSecret: users.totpSecret, totpLastStep: users.totpLastStep, theme: users.theme, locale: users.locale } })
    .from(loginChallenges)
    .innerJoin(users, eq(users.id, loginChallenges.userId))
    .where(and(eq(loginChallenges.id, sha256(token)), gt(loginChallenges.expiresAt, sql`now()`)))
    .limit(1);
  if (!row || row.user.isDisabled) return null;
  return row;
}

// A wrong code: counts against the challenge, which is used up after
// MAX_ATTEMPTS (back to the password). A used-up challenge is kept until it
// expires so the page can say why, but no code is accepted on it. Returns
// whether it's still usable.
export async function failChallenge(id: string) {
  const [row] = await db
    .update(loginChallenges)
    .set({ attempts: sql`${loginChallenges.attempts} + 1` })
    .where(eq(loginChallenges.id, id))
    .returning({ attempts: loginChallenges.attempts });
  return Boolean(row) && row.attempts < MAX_ATTEMPTS;
}

export const isUsedUp = (challenge: { attempts: number }) => challenge.attempts >= MAX_ATTEMPTS;

export async function endChallenge() {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  if (token) await db.delete(loginChallenges).where(eq(loginChallenges.id, sha256(token)));
  jar.delete({ name: CHALLENGE_COOKIE, path: "/login" });
}

// Ten single-use codes like "k7m2-9xq4", replacing any earlier ones. Only
// their hashes are stored; the codes are shown once.
export async function newRecoveryCodes(userId: number) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: 10 }, () => {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  await db.insert(userRecoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256(c) })));
  return codes;
}

// Uses up a recovery code if it's one of theirs and unused.
export async function redeemRecoveryCode(userId: number, raw: string) {
  const code = raw.trim().toLowerCase().replace(/\s/g, "");
  const normalized = /^[a-z0-9]{8}$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(normalized)) return false;
  const hash = sha256(normalized);
  const unused = await db
    .select({ id: userRecoveryCodes.id, codeHash: userRecoveryCodes.codeHash })
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
  const match = unused.find((r) => timingSafeEqual(Buffer.from(r.codeHash), Buffer.from(hash)));
  if (!match) return false;
  // only the first of two simultaneous uses wins
  const [used] = await db
    .update(userRecoveryCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(userRecoveryCodes.id, match.id), isNull(userRecoveryCodes.usedAt)))
    .returning({ id: userRecoveryCodes.id });
  return Boolean(used);
}

export async function recoveryCodesLeft(userId: number) {
  return db.$count(userRecoveryCodes, and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
}

// Records a used code's step so it can't be used again (only moves forward).
export async function markStepUsed(userId: number, step: number) {
  const [row] = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, userId), sql`coalesce(${users.totpLastStep}, -1) < ${step}`))
    .returning({ id: users.id });
  return Boolean(row);
}

// Turns two-step login off for a user (an owner's reset, or the command
// line): they set it up again at their next sign-in. Also signs them out.
export async function resetTwoFactor(userId: number) {
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null }).where(eq(users.id, userId));
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
}

export async function purgeExpiredChallenges() {
  await db.delete(loginChallenges).where(lt(loginChallenges.expiresAt, sql`now()`));
}

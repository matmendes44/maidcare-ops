"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { safeNext } from "@/lib/auth/safe-next";
import { clearFailedLogins, isRateLimited, recordFailedLogin } from "@/lib/auth/rate-limit";
import { createSession, deleteSession } from "@/lib/auth/session";
import { generateSecret, verifyCode } from "@/lib/auth/totp";
import {
  currentChallenge,
  endChallenge,
  failChallenge,
  isUsedUp,
  markStepUsed,
  newRecoveryCodes,
  openSecret,
  sealSecret,
  startChallenge,
  redeemRecoveryCode,
} from "@/lib/auth/two-factor";
import { getI18n } from "@/lib/i18n/server";
import { setPreferenceCookies } from "@/lib/preferences";
import { demoUsers, isDemo, type DemoRole } from "@/lib/demo";

export type LoginState = { message?: string; email?: string };

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const { t } = await getI18n();
  if (!email || !password) return { message: t.login.missing, email };

  const ip = await clientIp();
  if (await isRateLimited(email, ip)) {
    return { message: t.login.rateLimited, email };
  }

  const user = await db.query.users.findFirst({
    columns: { id: true, passwordHash: true, isDisabled: true, theme: true, locale: true, totpSecret: true, totpEnabledAt: true },
    where: eq(users.email, email),
  });
  // always run the hash so response time doesn't reveal which emails exist
  const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));

  if (!user || !valid || user.isDisabled) {
    await recordFailedLogin(email, ip);
    return { message: t.login.incorrect, email };
  }

  // The password is right, but there's no session until the two-step code
  // is too. Failed attempts aren't cleared yet: they also limit code guessing.
  const next = safeNext(formData.get("next"));
  if (user.totpSecret && user.totpEnabledAt) {
    await startChallenge(user.id, "verify", next);
    redirect("/login/verify");
  }
  // two-step login is required: set it up now
  await startChallenge(user.id, "enroll", next, generateSecret());
  redirect("/login/setup");
}

// The public demo only: straight in as the demo owner or staff member. Their
// passwords are random and never shown, so nobody can change them, and the
// real sign-in above (password + two-step code) still works for other accounts.
export async function demoSignIn(role: DemoRole) {
  if (!isDemo() || !(role in demoUsers)) redirect("/login");
  const user = await db.query.users.findFirst({
    columns: { id: true, email: true, theme: true, locale: true, isDisabled: true },
    where: eq(users.email, demoUsers[role].email),
  });
  if (!user || user.isDisabled) redirect("/login");
  await finishLogin(user);
  redirect("/");
}

export type TwoFactorState = { message?: string; expired?: boolean; codes?: string[]; next?: string };

// Both factors passed: the session starts.
async function finishLogin(user: { id: number; email: string; theme: "system" | "light" | "dark"; locale: "en-US" | "pt-BR" }) {
  await clearFailedLogins(user.email);
  await endChallenge();
  await createSession(user.id);
  await db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, user.id));
  // this browser picks up the user's theme and language from now on
  await setPreferenceCookies({ theme: user.theme, locale: user.locale });
}

const expired = (message = "Your sign-in timed out. Enter your password again."): TwoFactorState => ({ expired: true, message });

// A wrong code: counts toward the sign-in limit and the challenge's tries.
async function wrongCode(email: string, challengeId: string, ip: string | null, message: string): Promise<TwoFactorState> {
  await recordFailedLogin(email, ip, "code");
  return (await failChallenge(challengeId)) ? { message } : expired("Too many wrong codes. Enter your password again.");
}

// The code from their authenticator app, or one of their recovery codes.
export async function verifyTwoFactor(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const found = await currentChallenge();
  if (!found || found.challenge.purpose !== "verify" || !found.user.totpSecret) return expired();
  const { user, challenge } = found;
  if (isUsedUp(challenge)) return expired("Too many wrong codes. Enter your password again.");
  const ip = await clientIp();
  const { t } = await getI18n();
  if (await isRateLimited(user.email, ip, "code")) return { message: t.login.rateLimited };

  const code = String(formData.get("code") ?? "");
  if (formData.get("mode") === "recovery") {
    if (!(await redeemRecoveryCode(user.id, code))) return wrongCode(user.email, challenge.id, ip, "That recovery code isn't right or was already used.");
  } else {
    const step = verifyCode(openSecret(user.totpSecret!), code, user.totpLastStep);
    // markStepUsed also refuses a code someone else just used
    if (step == null || !(await markStepUsed(user.id, step)))
      return wrongCode(user.email, challenge.id, ip, "That code isn't right. Check your authenticator app and try the current code.");
  }
  await finishLogin(user);
  redirect(challenge.next ?? "/");
}

// First sign-in after two-step login became required: confirm the app is
// set up with one code, then show the recovery codes once.
export async function confirmEnrollment(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const found = await currentChallenge();
  if (!found || found.challenge.purpose !== "enroll" || !found.challenge.pendingSecret) return expired();
  const { user, challenge } = found;
  if (isUsedUp(challenge)) return expired("Too many wrong codes. Enter your password again.");
  const ip = await clientIp();
  const { t } = await getI18n();
  if (await isRateLimited(user.email, ip, "code")) return { message: t.login.rateLimited };

  const secret = openSecret(challenge.pendingSecret!);
  const step = verifyCode(secret, String(formData.get("code") ?? ""), null);
  if (step == null) return wrongCode(user.email, challenge.id, ip, "That code doesn't match. Make sure you scanned this QR code, then enter the current code.");

  await db
    .update(users)
    .set({ totpSecret: sealSecret(secret), totpEnabledAt: new Date().toISOString(), totpLastStep: step })
    .where(eq(users.id, user.id));
  const codes = await newRecoveryCodes(user.id);
  await finishLogin(user);
  return { codes, next: challenge.next ?? "/" };
}

export async function cancelSignIn() {
  await endChallenge();
  redirect("/login");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}

"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import { sessions, userAvatars, users } from "@/db/schema";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "@/lib/auth/password";
import { isRateLimited, recordFailedLogin } from "@/lib/auth/rate-limit";
import { currentSessionId, requireUser } from "@/lib/auth/session";
import { verifyCode } from "@/lib/auth/totp";
import { markStepUsed, newRecoveryCodes, openSecret } from "@/lib/auth/two-factor";
import { pgError } from "@/lib/db-helpers";
import { toAvatar } from "@/lib/photo";
import { isLocale, isTheme } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { setPreferenceCookies } from "@/lib/preferences";
import { logError } from "@/lib/log";
import { phrase } from "@/lib/i18n/tr";
import { isDemo } from "@/lib/demo";

export type SettingsState = { ok?: string; message?: string; errors?: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Re-checking the password before account changes. Wrong guesses count
// toward the same limit as sign-in, so a left-open session can't be used to
// brute-force the password.
async function checkPassword(userId: number, email: string, password: string) {
  if (await isRateLimited(email, null, "reauth")) return false;
  const row = await db.query.users.findFirst({ columns: { passwordHash: true }, where: eq(users.id, userId) });
  const valid = Boolean(row) && (await verifyPassword(password, row!.passwordHash));
  if (!valid) await recordFailedLogin(email, null, "reauth");
  return valid;
}

export async function changeEmail(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const [user, { t }] = await Promise.all([requireUser(), getI18n()]);
  const email = text(formData, "email").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { errors: { email: t.settings.email.invalid } };
  if (email === user.email) return { errors: { email: t.settings.email.same } };
  if (!(await checkPassword(user.id, user.email, text(formData, "currentPassword"))))
    return { errors: { currentPassword: t.settings.email.wrongPassword } };

  try {
    await db.update(users).set({ email }).where(eq(users.id, user.id));
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23505" && pg.constraint === "users_email_key") return { errors: { email: t.settings.email.taken } };
    logError("email change failed", err);
    return { message: t.settings.failed };
  }
  refresh();
  return { ok: t.settings.email.saved };
}

export async function changePassword(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const [user, { t }] = await Promise.all([requireUser(), getI18n()]);
  const current = text(formData, "currentPassword");
  const next = text(formData, "newPassword");
  if (next.length < MIN_PASSWORD_LENGTH) return { errors: { newPassword: t.settings.password.tooShort(MIN_PASSWORD_LENGTH) } };
  if (next !== text(formData, "confirmPassword")) return { errors: { confirmPassword: t.settings.password.mismatch } };
  if (!(await checkPassword(user.id, user.email, current)))
    return { errors: { currentPassword: t.settings.password.wrongPassword } };
  if (next === current) return { errors: { newPassword: t.settings.password.sameAsOld } };

  const sessionId = await currentSessionId();
  try {
    await db.batch([
      db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, user.id)),
      // sign out everywhere else; this browser stays signed in
      db.delete(sessions).where(and(eq(sessions.userId, user.id), sessionId ? ne(sessions.id, sessionId) : undefined)),
    ]);
  } catch (err) {
    logError("password change failed", err);
    return { message: t.settings.failed };
  }
  return { ok: t.settings.password.saved };
}

// The browser shrinks photos before uploading; this re-checks that the file
// really is an image and stores a 256×256 WebP whatever was sent.
export async function uploadAvatar(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const [user, { t }] = await Promise.all([requireUser(), getI18n()]);
  // demo accounts are shared by every visitor
  if (isDemo()) return { message: phrase("Profile photos can't be changed in the demo.") };
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { message: t.settings.photo.unreadable };
  if (file.size > MAX_UPLOAD_BYTES) return { message: t.settings.photo.tooLarge };

  const image = await toAvatar(Buffer.from(await file.arrayBuffer()));
  if (!image) return { message: t.settings.photo.unreadable };

  try {
    await db.batch([
      db
        .insert(userAvatars)
        .values({ userId: user.id, image })
        .onConflictDoUpdate({ target: userAvatars.userId, set: { image, updatedAt: sql`now()` } }),
      db.update(users).set({ avatarUpdatedAt: sql`now()` }).where(eq(users.id, user.id)),
    ]);
  } catch (err) {
    logError("avatar upload failed", err);
    return { message: t.settings.photo.failed };
  }
  refresh();
  return { ok: t.settings.photo.saved };
}

export async function removeAvatar(): Promise<SettingsState> {
  const [user, { t }] = await Promise.all([requireUser(), getI18n()]);
  await db.batch([
    db.delete(userAvatars).where(eq(userAvatars.userId, user.id)),
    db.update(users).set({ avatarUpdatedAt: null }).where(eq(users.id, user.id)),
  ]);
  refresh();
  return { ok: t.settings.photo.removed };
}

export async function setTheme(theme: string): Promise<SettingsState> {
  const [user, { t }] = await Promise.all([requireUser(), getI18n()]);
  if (!isTheme(theme)) return { message: t.settings.appearance.failed };
  await db.update(users).set({ theme }).where(eq(users.id, user.id));
  await setPreferenceCookies({ theme });
  return {};
}

export async function setLocale(locale: string): Promise<SettingsState> {
  const user = await requireUser();
  if (!isLocale(locale)) return { message: phrase("Unknown language.") };
  await db.update(users).set({ locale }).where(eq(users.id, user.id));
  await setPreferenceCookies({ locale });
  // re-render in the new language
  refresh();
  return {};
}

export type RecoveryState = { message?: string; codes?: string[] };

// New recovery codes (the old ones stop working). Needs a current code from
// the authenticator app, so an unlocked screen alone isn't enough.
export async function regenerateRecoveryCodes(_prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const user = await requireUser();
  if (await isRateLimited(user.email, null, "code")) return { message: phrase("Too many attempts. Try again in 15 minutes.") };
  const row = await db.query.users.findFirst({ columns: { totpSecret: true, totpLastStep: true }, where: eq(users.id, user.id) });
  if (!row?.totpSecret) return { message: phrase("Two-step login isn't set up for this account.") };
  const step = verifyCode(openSecret(row.totpSecret), text(formData, "code"), row.totpLastStep);
  if (step == null || !(await markStepUsed(user.id, step))) {
    await recordFailedLogin(user.email, null, "code");
    return { message: phrase("That code isn't right. Enter the current code from your authenticator app.") };
  }
  return { codes: await newRecoveryCodes(user.id) };
}

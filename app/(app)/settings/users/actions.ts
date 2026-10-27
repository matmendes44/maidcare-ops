"use server";

import { and, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { MIN_PASSWORD_LENGTH, hashPassword } from "@/lib/auth/password";
import { roles, type Role } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/session";
import { resetTwoFactor } from "@/lib/auth/two-factor";
import { pgError } from "@/lib/db-helpers";

export type UserActionState = { ok?: string; message?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isRole = (r: string): r is Role => (roles as readonly string[]).includes(r);
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

// The app must always keep at least one active owner.
async function otherActiveOwners(userId: number) {
  return db.$count(users, and(eq(users.role, "owner"), eq(users.isDisabled, false), ne(users.id, userId)));
}

async function target(userId: number, actingId: number) {
  if (userId === actingId) return { error: "You can't change your own account here. Use Settings." };
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return row ? { row } : { error: "That user no longer exists." };
}

// New accounts get the password you choose here; at their first sign-in
// they set up two-step login.
export async function addUser(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const access = await checkPermission("users.manage");
  if (!access.user) return { message: access.denied };
  const email = text(formData, "email").toLowerCase();
  const name = text(formData, "name");
  const role = text(formData, "role");
  const password = String(formData.get("password") ?? "");
  if (!EMAIL_RE.test(email)) return { message: "Enter a valid email address." };
  if (!name || name.length > 80) return { message: "Enter their name." };
  if (!isRole(role)) return { message: "Choose a role." };
  if (password.length < MIN_PASSWORD_LENGTH) return { message: `The password needs at least ${MIN_PASSWORD_LENGTH} characters.` };
  try {
    await db.insert(users).values({ email, name, role, passwordHash: await hashPassword(password) });
  } catch (err) {
    if (pgError(err)?.code === "23505") return { message: "Someone already has that email." };
    throw err;
  }
  refresh();
  return { ok: `${name} can now sign in with ${email} and the password you set. They'll set up two-step login at their first sign-in.` };
}

export async function setRole(userId: number, role: string): Promise<UserActionState> {
  const access = await checkPermission("users.manage");
  if (!access.user) return { message: access.denied };
  if (!isRole(role)) return { message: "Unknown role." };
  const t = await target(userId, access.user.id);
  if (!t.row) return { message: t.error };
  if (t.row.role === "owner" && role !== "owner" && (await otherActiveOwners(userId)) === 0) return { message: "There must always be an active owner." };
  await db.update(users).set({ role }).where(eq(users.id, userId));
  refresh();
  return { ok: "Role changed." };
}

export async function setDisabled(userId: number, disabled: boolean): Promise<UserActionState> {
  const access = await checkPermission("users.manage");
  if (!access.user) return { message: access.denied };
  const t = await target(userId, access.user.id);
  if (!t.row) return { message: t.error };
  if (disabled && t.row.role === "owner" && (await otherActiveOwners(userId)) === 0) return { message: "There must always be an active owner." };
  await db.update(users).set({ isDisabled: disabled }).where(eq(users.id, userId));
  // disabling also ends their sessions right away
  if (disabled) await db.delete(sessions).where(eq(sessions.userId, userId));
  refresh();
  return { ok: disabled ? "Account disabled and signed out." : "Account enabled." };
}

// For a lost phone without recovery codes: they set up two-step login again
// at their next sign-in. Signs them out everywhere.
export async function resetUserTwoFactor(userId: number): Promise<UserActionState> {
  const access = await checkPermission("users.manage");
  if (!access.user) return { message: access.denied };
  const t = await target(userId, access.user.id);
  if (!t.row) return { message: t.error };
  await resetTwoFactor(userId);
  await db.delete(sessions).where(eq(sessions.userId, userId));
  refresh();
  return { ok: "Two-step login reset. They'll set it up again at their next sign-in." };
}

export async function signOutUser(userId: number): Promise<UserActionState> {
  const access = await checkPermission("users.manage");
  if (!access.user) return { message: access.denied };
  const t = await target(userId, access.user.id);
  if (!t.row) return { message: t.error };
  await db.delete(sessions).where(eq(sessions.userId, userId));
  refresh();
  return { ok: "Signed out everywhere." };
}

export async function setUserPassword(userId: number, _prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const access = await checkPermission("users.manage");
  if (!access.user) return { message: access.denied };
  const t = await target(userId, access.user.id);
  if (!t.row) return { message: t.error };
  const password = String(formData.get("password") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) return { message: `At least ${MIN_PASSWORD_LENGTH} characters.` };
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  refresh();
  return { ok: "Password changed and signed out everywhere." };
}


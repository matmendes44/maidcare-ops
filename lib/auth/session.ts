import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { SESSION_COOKIE } from "./cookie";
import { can, permissions, type Permission, type Role } from "./permissions";
import { translator } from "@/lib/i18n/tr";

const SESSION_DAYS = 14;

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  theme: (typeof users.$inferSelect)["theme"];
  locale: (typeof users.$inferSelect)["locale"];
  avatarUpdatedAt: string | null;
  role: Role;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Server Actions only: cookies can't be set while rendering.
export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt: expires.toISOString(),
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

// The stored id (token hash) of this request's session, if any.
export async function currentSessionId() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export async function deleteSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

// The secure check: looks the session up in the database on every request
// (deduplicated per render), so revoking a session or disabling a user takes
// effect immediately. Deliberately not `use cache: private`, which would let
// the browser keep showing data for minutes after a revoke.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      theme: users.theme,
      locale: users.locale,
      avatarUpdatedAt: users.avatarUpdatedAt,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, hashToken(token)),
        gt(sessions.expiresAt, sql`now()`),
        eq(users.isDisabled, false),
      ),
    )
    .limit(1);

  return row ?? null;
});

// Call at the top of every data function and Server Action that touches
// customer data. Pages, layouts and the proxy are not enough on their own:
// Server Actions can be invoked directly, bypassing the page that renders them.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export class PermissionError extends Error {}

// For Server Actions and data functions behind a permission: the signed-in
// user, or an error saying what they aren't allowed to do. Check it on the
// server even when the button is hidden; actions can be called directly.
export async function requirePermission(permission: Permission) {
  const user = await requireUser();
  if (!can(user, permission)) {
    throw new PermissionError(`You don't have permission to: ${permissions[permission].toLowerCase()}.`);
  }
  return user;
}

// The same check for actions that report errors as a message.
export async function checkPermission(permission: Permission): Promise<{ user: SessionUser; denied?: undefined } | { user?: undefined; denied: string }> {
  const user = await requireUser();
  return can(user, permission)
    ? { user }
    : { denied: deniedMessage(user, permission) };
}

// In the person's language: "You don't have permission to: delete customers. Ask the owner."
function deniedMessage(user: SessionUser, permission: Permission) {
  const tr = translator(user.locale);
  const what = tr(permissions[permission]);
  return tr("You don't have permission to: {what}. Ask the owner.", { what: what.charAt(0).toLowerCase() + what.slice(1) });
}

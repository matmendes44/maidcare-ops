import "server-only";

import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationReads, notifications } from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";
import type { Locale } from "@/lib/i18n/config";
import { formatters } from "@/lib/i18n/format";
import { translator, type Vars } from "@/lib/i18n/tr";

// Adds a notification (the bell in the header) for everyone signed in, or
// only for one role (`audience: "owner"`). href must be a path inside the app.
// title and body are English with {placeholders} filled from vars when shown,
// in each reader's language; a var named `day` ("YYYY-MM-DD") or `at` (a
// timestamp) is shown as a date in that language.
export async function notify(n: { kind: string; title: string; body?: string; href?: string; audience?: Role; vars?: Vars }) {
  await db.insert(notifications).values({
    kind: n.kind,
    title: n.title.slice(0, 200),
    body: n.body?.slice(0, 500) ?? null,
    href: n.href && /^\/[^/]/.test(n.href) ? n.href : null,
    audience: n.audience ?? null,
    vars: n.vars ?? null,
  });
}

function shown(locale: Locale, text: string, vars: Vars | null) {
  const tr = translator(locale);
  if (!vars) return tr(text);
  const fmt = formatters(locale);
  const filled: Vars = { ...vars };
  if (typeof vars.day === "string") filled.day = `${fmt.weekdays.short[(new Date(`${vars.day}T12:00:00Z`).getUTCDay() + 6) % 7]}, ${fmt.calendarDate(vars.day)}`;
  if (typeof vars.at === "string") filled.at = `${fmt.day(vars.at)}, ${fmt.time(vars.at)}`;
  return tr(text, filled);
}

const recent = sql`now() - interval '60 days'`;
const visibleTo = (role: Role) => and(gt(notifications.createdAt, recent), or(isNull(notifications.audience), eq(notifications.audience, role)));

// The latest notifications for someone, with whether they've read each.
export async function notificationsFor(userId: number, role: Role, locale: Locale, limit = 20) {
  const rows = await db
    .select({ n: notifications, readAt: notificationReads.readAt })
    .from(notifications)
    .leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, userId)))
    .where(visibleTo(role))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, userId)))
    .where(and(isNull(notificationReads.notificationId), visibleTo(role)));
  return {
    items: rows.map(({ n, readAt }) => ({
      id: n.id,
      kind: n.kind,
      title: shown(locale, n.title, n.vars as Vars | null),
      body: n.body && shown(locale, n.body, n.vars as Vars | null),
      href: n.href,
      createdAt: n.createdAt,
      read: readAt !== null,
    })),
    unread,
  };
}

export async function markRead(userId: number, role: Role, ids: number[] | "all") {
  if (ids === "all") {
    await db.execute(sql`insert into notification_reads (notification_id, user_id)
      select id, ${userId} from notifications where created_at > now() - interval '60 days' and (audience is null or audience = ${role})
      on conflict do nothing`);
    return;
  }
  if (ids.length) await db.insert(notificationReads).values(ids.slice(0, 100).map((notificationId) => ({ notificationId, userId }))).onConflictDoNothing();
}

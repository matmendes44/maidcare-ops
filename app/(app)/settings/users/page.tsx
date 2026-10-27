import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { asc, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, permissions, roleLabels, roles } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { AddUserForm, UserActions } from "./users-forms";

async function UsersContent() {
  const me = await requireUser();
  // hidden from anyone who can't manage users, as if it didn't exist
  if (!can(me, "users.manage")) notFound();
  const { fmt } = await getI18n();
  const [rows, active] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isDisabled: users.isDisabled,
        totpEnabledAt: users.totpEnabledAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(asc(users.isDisabled), asc(users.name)),
    db
      .select({ userId: sessions.userId, n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(sql`${sessions.expiresAt} > now()`)
      .groupBy(sessions.userId),
  ]);
  const sessionsOf = (id: number) => active.find((a) => a.userId === id)?.n ?? 0;

  return (
    <div className="max-w-5xl">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>
      <h1 className="text-3xl font-bold">Users and roles</h1>
      <p className="mt-1 text-sm text-muted-foreground">Everyone signs in with a password and two-step login.</p>

      <div className="mt-6 overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Two-step login</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id} className="align-top">
                <TableCell data-primary className="whitespace-normal">
                  <div className="font-medium">
                    {u.name}
                    {u.id === me.id && <span className="ml-1.5 text-[0.8rem] font-normal text-muted-foreground">(you)</span>}
                  </div>
                  <div className="text-[0.8rem] text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell data-label="Role">{roleLabels[u.role]}</TableCell>
                <TableCell data-label="Two-step login">
                  {u.totpEnabledAt ? <Badge variant="success">On</Badge> : <Badge variant="muted">Set up at next sign-in</Badge>}
                </TableCell>
                <TableCell data-label="Last sign-in">{u.lastLoginAt ? fmt.stamp(u.lastLoginAt) : "Never"}</TableCell>
                <TableCell data-label="Status">
                  {u.isDisabled ? <Badge variant="muted">Disabled</Badge> : <Badge variant="info">Active</Badge>}
                  {sessionsOf(u.id) > 0 && (
                    <div className="mt-1 text-[0.75rem] text-muted-foreground">
                      Signed in on {sessionsOf(u.id)} device{sessionsOf(u.id) === 1 ? "" : "s"}
                    </div>
                  )}
                </TableCell>
                <TableCell data-actions className="whitespace-normal">
                  {u.id !== me.id && <UserActions user={u} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-base font-semibold">Add a person</h2>
          <AddUserForm />
        </div>
        <div className="rounded-lg border bg-card p-4 text-sm">
          <h2 className="mb-2 text-base font-semibold">What each role can do</h2>
          <p className="mb-3 text-muted-foreground">
            The owner can do everything. Admin and staff can do day-to-day work (customers, properties, appointments, draft invoices, the
            Fleet page) but none of these until they&apos;re allowed in <code className="text-[0.8rem]">lib/auth/permissions.ts</code>:
          </p>
          <ul className="ml-5 list-disc text-muted-foreground">
            {Object.values(permissions).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-3 text-[0.8rem] text-muted-foreground">Roles: {roles.map((r) => roleLabels[r]).join(", ")}.</p>
        </div>
      </section>
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <UsersContent />
    </Suspense>
  );
}

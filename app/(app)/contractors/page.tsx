import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { describeRate } from "@/lib/contractors/pay";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { NoAccess } from "../finances/no-access";
import { getContractors } from "./data";

async function Contractors() {
  const user = await getCurrentUser();
  if (!can(user, "contractors.view")) return <NoAccess what="contractors" />;
  const day = await today();
  const [rows, { fmt }] = await Promise.all([getContractors(day), getI18n()]);
  const owedTotal = rows.reduce((s, r) => s + Math.max(0, r.owed), 0);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Contractors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The cleaners: days worked, pay and 1099s.{owedTotal > 0 && ` Unpaid right now: ${fmt.money(owedTotal)}.`}
          </p>
        </div>
        {can(user, "contractors.manage") && (
          <Link href="/contractors/new" className={buttonVariants()}>
            <Plus aria-hidden="true" />
            Add contractor
          </Link>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Contractor</TableHead>
              <TableHead>Pay</TableHead>
              <TableHead className="text-right">Days this month</TableHead>
              <TableHead className="text-right">Earned this month</TableHead>
              <TableHead className="text-right">Unpaid</TableHead>
              <TableHead>W-9</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No contractors yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id} className="relative cursor-pointer">
                  <TableCell data-primary>
                    <Link href={`/contractors/${c.id}`} className="font-semibold text-foreground after:absolute after:inset-0 hover:text-link">
                      {c.firstName} {c.lastName}
                    </Link>
                    <span className="ml-1.5 font-mono text-[0.75rem] text-muted-foreground">{c.vendorCode}</span>
                    {!c.isActive && (
                      <Badge variant="muted" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                    {c.businessName && <div className="text-[0.8rem] text-muted-foreground">{c.businessName}</div>}
                  </TableCell>
                  <TableCell data-label="Pay">{c.currentRate ? describeRate(c.currentRate, fmt.money) : <span className="text-amber-700 dark:text-amber-400">No rate set</span>}</TableCell>
                  <TableCell data-label="Days this month" className="text-right tabular-nums">
                    {c.daysThisMonth}
                  </TableCell>
                  <TableCell data-label="Earned this month" className="text-right tabular-nums">
                    {fmt.money(c.earnedThisMonth)}
                  </TableCell>
                  <TableCell data-label="Unpaid" className={c.owed > 0 ? "text-right font-medium tabular-nums" : "text-right text-muted-foreground tabular-nums"}>
                    {fmt.money(c.owed)}
                  </TableCell>
                  <TableCell data-label="W-9">{c.w9ReceivedOn ? <Badge variant="success">On file</Badge> : <Badge variant="destructive">Missing</Badge>}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-[0.8rem] text-muted-foreground">Unpaid is everything earned from completed visits minus everything paid to them (expenses to their vendor record).</p>
    </>
  );
}

export default function ContractorsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Contractors />
    </Suspense>
  );
}

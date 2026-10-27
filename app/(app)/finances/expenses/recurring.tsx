import Link from "next/link";
import { CalendarX, Pencil, Plus, Trash2 } from "lucide-react";
import { Kpi } from "@/components/charts";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel, frequencies, paidWith } from "@/lib/expenses/options";
import { yearlyCost, type ScheduleState } from "@/lib/expenses/recurring";
import { getI18n } from "@/lib/i18n/server";
import { deleteSchedule, endSchedule } from "./actions";
import { getSchedules, type ScheduleRow } from "./data";

const stateBadge: Record<ScheduleState, { label: string; variant: "success" | "info" | "destructive" | "muted" | "secondary" }> = {
  paid: { label: "Paid", variant: "success" },
  upcoming: { label: "Due soon", variant: "info" },
  due: { label: "Due", variant: "secondary" },
  overdue: { label: "Overdue", variant: "destructive" },
  not_started: { label: "Starts later", variant: "muted" },
  ended: { label: "Ended", variant: "muted" },
};

export async function Recurring({ today, manage }: { today: string; manage: boolean }) {
  const [schedules, { fmt }] = await Promise.all([getSchedules(today), getI18n()]);
  const active = schedules.filter((s) => !s.ended);
  const ended = schedules.filter((s) => s.ended);
  const perMonth = active.reduce((sum, s) => sum + yearlyCost(s) / 12, 0);
  const late = active.filter((s) => s.status.state === "overdue" || s.status.state === "due");
  const missed = active.reduce((n, s) => n + s.status.missed.length, 0);

  const table = (list: ScheduleRow[], showActions: boolean) => (
    <div className="overflow-hidden rounded-lg border">
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>Vendor</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>How often</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last paid</TableHead>
            <TableHead className="text-right">Per year</TableHead>
            {showActions && manage && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((s) => {
            const badge = stateBadge[s.status.state];
            const differs = s.lastPaid && s.lastPaid.cents !== s.amountCents && !s.amountVaries;
            return (
              <TableRow key={s.id}>
                <TableCell data-primary>
                  <Link href={`/finances/expenses?tab=list&vendor=${s.vendorId}&recurring=yes`} className="font-semibold hover:text-link">
                    {s.vendorName}
                  </Link>
                  <div className="text-[0.8rem] text-muted-foreground">
                    {categoryLabel(s.category)} · {paidWith({ ...s, reference: null })}
                  </div>
                  {s.description && <div className="max-w-xs truncate text-[0.8rem] text-muted-foreground">{s.description}</div>}
                </TableCell>
                <TableCell data-label="Amount" className="text-right tabular-nums">
                  {s.amountVaries && <span title="The amount varies">~</span>}
                  {fmt.money(s.amountCents)}
                </TableCell>
                <TableCell data-label="How often">{frequencies[s.frequency]}</TableCell>
                <TableCell data-label="Status">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {s.status.dueDate && s.status.state !== "ended" && (
                      <span className="text-[0.8rem] text-muted-foreground">
                        {s.status.state === "paid" || s.status.state === "upcoming" || s.status.state === "not_started" ? "next " : ""}
                        {fmt.calendarDate(s.status.dueDate)}
                      </span>
                    )}
                  </div>
                  {s.status.missed.length > 0 && (
                    <div className="mt-0.5 text-[0.75rem] text-destructive">
                      {s.status.missed.length} earlier {s.status.missed.length === 1 ? "payment" : "payments"} not recorded ({s.status.missed.map((d) => fmt.calendarDate(d)).join(", ")}).{" "}
                      <Link href={`/finances/expenses?tab=list&vendor=${s.vendorId}&recurring=no`} className="underline underline-offset-2">
                        Already entered? Open it and tick “Payment for the recurring expense”
                      </Link>
                    </div>
                  )}
                  {s.endDate && !s.ended && <div className="mt-0.5 text-[0.75rem] text-muted-foreground">ends {fmt.calendarDate(s.endDate)}</div>}
                </TableCell>
                <TableCell data-label="Last paid" className="text-muted-foreground">
                  {s.lastPaid ? (
                    <>
                      {fmt.calendarDate(s.lastPaid.day)}
                      {differs && <div className="text-[0.75rem] text-amber-700 dark:text-amber-400">paid {fmt.money(s.lastPaid.cents)}, not {fmt.money(s.amountCents)}</div>}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell data-label="Per year" className="text-right tabular-nums">
                  {fmt.money(yearlyCost(s))}
                </TableCell>
                {showActions && manage && (
                  <TableCell data-label="Actions" className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {(s.status.state === "due" || s.status.state === "overdue" || s.status.state === "upcoming") && s.status.dueDate && (
                        <Link href={`/finances/expenses/new?recurring=${s.id}&due=${s.status.dueDate}`} className={buttonVariants({ size: "sm" })}>
                          Record
                        </Link>
                      )}
                      {s.status.state === "paid" && (
                        <Link href={`/finances/expenses/new?recurring=${s.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                          Record
                        </Link>
                      )}
                      <Link href={`/finances/expenses/recurring/${s.id}/edit`} className={buttonVariants({ size: "icon-sm", variant: "ghost" })} aria-label={`Edit ${s.vendorName}`} title="Edit">
                        <Pencil aria-hidden="true" />
                      </Link>
                      {s.lastPaid ? (
                        <ConfirmButton
                          label={`End ${s.vendorName}`}
                          icon={<CalendarX aria-hidden="true" />}
                          size="icon-sm"
                          variant="ghost"
                          title={`End ${s.vendorName}?`}
                          description="Nothing more will be expected from today (a cancelled subscription, say). Payments already recorded stay."
                          confirmLabel="End it"
                          action={endSchedule.bind(null, s.id)}
                        />
                      ) : (
                        <ConfirmButton
                          label={`Delete ${s.vendorName}`}
                          icon={<Trash2 aria-hidden="true" />}
                          size="icon-sm"
                          variant="ghost"
                          title={`Delete ${s.vendorName}?`}
                          description="No payments have been recorded for it, so it can be deleted."
                          confirmLabel="Delete"
                          action={deleteSchedule.bind(null, s.id)}
                        />
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Per month" value={fmt.money(Math.round(perMonth))} sub={`${active.length} recurring`} />
        <Kpi label="Per year" value={fmt.money(Math.round(perMonth * 12))} />
        <Kpi label="Due or overdue" value={String(late.length)} tone={late.some((s) => s.status.state === "overdue") ? "bad" : late.length ? "warn" : undefined} sub={late.length ? fmt.money(late.reduce((n, s) => n + s.amountCents, 0)) : "all caught up"} />
        <Kpi label="Not recorded (past year)" value={String(missed)} tone={missed ? "warn" : undefined} sub="earlier due dates with no payment" />
      </div>
      {active.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">No recurring expenses yet. Add insurance, software, phone or storage, or choose “Repeats” on a new expense.</p>
          {manage && (
            <Link href="/finances/expenses/recurring/new" className={buttonVariants({ className: "mt-4" })}>
              <Plus aria-hidden="true" />
              Add a recurring expense
            </Link>
          )}
        </div>
      ) : (
        table(active, true)
      )}
      {ended.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Ended ({ended.length})</summary>
          <div className="mt-3">{table(ended, true)}</div>
        </details>
      )}
      <p className="text-[0.8rem] text-muted-foreground">
        A due date counts as paid when a payment for it is recorded within half a period (a monthly bill paid a few days early or late still counts). Overdue means more than 3 days past due with nothing recorded.
      </p>
    </div>
  );
}

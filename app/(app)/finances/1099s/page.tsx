import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { Kpi } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { dueDate, maskTin, thresholdCents, yearStatus } from "@/lib/contractors/tax";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { taxYearSummary } from "../../contractors/data";
import { NoAccess } from "../no-access";
import { export1099s } from "./actions";
import { ExportForm } from "./export-form";

async function TaxYear({ searchParams }: Pick<PageProps<"/finances/1099s">, "searchParams">) {
  const user = await getCurrentUser();
  if (!can(user, "contractors.tax")) return <NoAccess what="1099s" />;
  const [sp, day, { fmt }] = await Promise.all([searchParams, today(), getI18n()]);
  const thisYear = Number(day.slice(0, 4));
  // in January the year to file is last year
  const defaultYear = Number(day.slice(5, 7)) <= 3 ? thisYear - 1 : thisYear;
  const year = typeof sp.year === "string" && /^\d{4}$/.test(sp.year) ? Number(sp.year) : defaultYear;
  const rows = (await taxYearSummary(year)).map((r) => ({
    ...r,
    status: yearStatus(year, {
      reportableCents: r.reportableCents,
      taxClassification: r.taxClassification,
      tinLast4: r.tinLast4,
      w9ReceivedOn: r.w9ReceivedOn,
      hasAddress: Boolean(r.street && r.city && r.state && r.zip),
      filed: r.filed,
    }),
  }));
  const needed = rows.filter((r) => r.status.state === "needs_1099" || r.status.state === "filed");
  const filed = rows.filter((r) => r.status.state === "filed");
  const blocked = rows.filter((r) => r.status.state === "needs_1099" && r.status.problems.length > 0);
  const missingW9 = rows.filter((r) => r.isActive && !r.w9ReceivedOn);
  const due = dueDate(year);
  const steps = [
    { done: missingW9.length === 0, text: `Get a W-9 from every contractor before you pay them${missingW9.length ? ` (${missingW9.length} missing)` : ""}.` },
    { done: true, text: "Record every payment as an expense to the contractor's vendor (Contract labor). Days worked come from their appointments." },
    { done: year < thisYear, text: `After December 31, check the totals below. Card, Venmo and PayPal payments are left out: the payment company reports those on a 1099-K.` },
    { done: blocked.length === 0, text: `Fix anything missing (W-9, tax ID, address)${blocked.length ? `: ${blocked.length} ${blocked.length === 1 ? "contractor" : "contractors"} not ready` : ""}.` },
    { done: filed.length === needed.length && needed.length > 0, text: `File each 1099-NEC with the IRS and send copy B to the contractor by ${fmt.calendarDate(due)} (Export below, then IRS IRIS or your accountant).` },
    { done: filed.length === needed.length && needed.length > 0, text: "Upload each filed 1099 on the contractor's page, so later changes to that year are flagged." },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">1099s</h1>
          <p className="mt-1 text-sm text-muted-foreground">1099-NEC filing for contractors: who needs one, what&apos;s missing, and the file to send.</p>
        </div>
        <div className="flex gap-1.5 text-sm" role="group" aria-label="Tax year">
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <Link
              key={y}
              href={`/finances/1099s?year=${y}`}
              aria-current={y === year ? "true" : undefined}
              className={cn("rounded-md border px-2.5 py-1", y === year ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground hover:bg-secondary")}
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`1099s needed for ${year}`} value={String(needed.length)} sub={`at ${fmt.money(thresholdCents(year))} or more`} />
        <Kpi label="Filed" value={`${filed.length} of ${needed.length}`} tone={filed.length < needed.length ? "warn" : undefined} />
        <Kpi label="Not ready" value={String(blocked.length)} tone={blocked.length ? "bad" : undefined} sub="missing W-9, tax ID or address" />
        <Kpi label="Due" value={fmt.calendarDate(due)} sub="to the IRS and to each contractor" />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Contractor</TableHead>
              <TableHead>Tax ID</TableHead>
              <TableHead className="text-right">On 1099-NEC</TableHead>
              <TableHead className="text-right">Card / app</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No contractors yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell data-primary>
                    <Link href={`/contractors/${r.id}`} className="font-semibold hover:text-link">
                      {r.lastName}, {r.firstName}
                    </Link>
                    {r.businessName && <div className="text-[0.8rem] text-muted-foreground">{r.businessName}</div>}
                  </TableCell>
                  <TableCell data-label="Tax ID" className="font-mono text-[0.85rem]">
                    {maskTin(r.tinType, r.tinLast4) ?? <span className="font-sans text-destructive">Missing</span>}
                  </TableCell>
                  <TableCell data-label="On 1099-NEC" className="text-right font-medium tabular-nums">
                    {fmt.money(r.reportableCents)}
                  </TableCell>
                  <TableCell data-label="Card / app" className="text-right text-muted-foreground tabular-nums">
                    {fmt.money(r.excludedCents)}
                  </TableCell>
                  <TableCell data-label="Status">
                    {r.status.state === "needs_1099" && <Badge variant={r.status.problems.length ? "destructive" : "info"}>{r.status.problems.length ? "Needs 1099 · not ready" : "Needs 1099 · ready"}</Badge>}
                    {r.status.state === "filed" && <Badge variant="success">Filed</Badge>}
                    {r.status.state === "below_threshold" && <span className="text-muted-foreground">Under {fmt.money(thresholdCents(year))}</span>}
                    {r.status.state === "exempt" && <span className="text-muted-foreground">Corporation: none</span>}
                    {r.status.changedSinceFiled && <div className="mt-1 text-[0.8rem] text-destructive">Payments changed after filing: a corrected 1099 may be needed.</div>}
                    {r.status.state === "needs_1099" &&
                      r.status.problems.map((p) => (
                        <div key={p} className="mt-1 text-[0.8rem] text-amber-700 dark:text-amber-400">
                          {p}
                        </div>
                      ))}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Tax-time checklist for {year}</h2>
          <ol className="grid gap-2.5 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-green" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="To do" />}
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[0.75rem] text-muted-foreground">
            The {fmt.money(thresholdCents(year))} threshold and these rules follow IRS guidance for {year}. Corporations are left out. Confirm with your accountant each year.
          </p>
        </section>
        <ExportForm action={export1099s.bind(null, year)} />
      </div>
    </>
  );
}

export default function TaxYearPage(props: PageProps<"/finances/1099s">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <TaxYear searchParams={props.searchParams} />
    </Suspense>
  );
}

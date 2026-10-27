import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { BarChart, chartColors, Kpi } from "@/components/charts";
import { linkClass } from "@/components/record";
import * as q from "@/lib/reports/queries";
import { change, monthLabel, monthsBetween, previousRange, type Range } from "@/lib/reports/range";
import { money, moneyShort, moneyWhole, percent, rangeQuery, Section, whole } from "./shared";
import { getI18n } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/tr";

export async function Overview({ range }: { range: Range }) {
  const { tr, locale } = await getI18n();
  const prev = previousRange(range);
  const [collected, collectedBefore, invoiced, invoicedBefore, unsent, owed, counts, visits, visitsBefore, unbilled, recurring, perHour, perHourBefore, byMonth, invoicedByMonth, vehicles] =
    await Promise.all([
      q.collectedTotal(range),
      q.collectedTotal(prev),
      q.invoicedTotal(range),
      q.invoicedTotal(prev),
      q.drafts(),
      q.outstanding(),
      q.customerCounts(range),
      q.visitCounts(range),
      q.visitCounts(prev),
      q.notInvoiced(range, 0),
      q.recurringRevenue(),
      q.revenuePerHour(range),
      q.revenuePerHour(prev),
      q.collectedByMonth(range),
      q.invoicedByMonth(range),
      q.maintenanceDue(),
    ]);
  const firstMonth = [...byMonth, ...invoicedByMonth].map((m) => m.month).sort()[0];
  const months = monthsBetween(firstMonth && `${firstMonth}-01` > range.from ? `${firstMonth}-01` : range.from, range.to).slice(-24);
  const cancelRate = visits.completed + visits.canceled ? visits.canceled / (visits.completed + visits.canceled) : 0;
  const net = counts.added - counts.lost;
  const vehicleIssues = vehicles.filter((v) => (v.milesLeft != null && v.milesLeft <= 500) || v.milOn || (v.battery && v.battery !== "normal"));
  const rq = rangeQuery(range);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={tr("Collected")} value={moneyWhole(collected.cents)} change={change(collected.cents, collectedBefore.cents)} sub={plural(tr, collected.payments, "{n} payment", "{n} payments", { n: whole(collected.payments) })} href={`/reports?tab=money&${rq}`} />
        <Kpi label={tr("Invoiced")} value={moneyWhole(invoiced.cents)} change={change(invoiced.cents, invoicedBefore.cents)} sub={plural(tr, invoiced.invoices, "{n} invoice finalized", "{n} invoices finalized", { n: whole(invoiced.invoices) })} href={`/reports?tab=money&${rq}`} />
        <Kpi
          label={tr("Outstanding")}
          value={moneyWhole(owed.total)}
          sub={
            owed.pastDue > 0 ? (
              <span className="font-medium text-destructive">{tr("{amount} past due", { amount: moneyWhole(owed.pastDue) })}</span>
            ) : (
              plural(tr, owed.invoices, "{n} open invoice", "{n} open invoices")
            )
          }
          tone={owed.pastDue > 0 ? "bad" : undefined}
          href={owed.pastDue > 0 ? "/finances?tab=past_due" : "/finances?tab=open"}
        />
        <Kpi
          label={tr("Drafts not sent")}
          value={moneyWhole(unsent.cents)}
          sub={plural(tr, unsent.count, "{n} draft invoice", "{n} draft invoices", { n: whole(unsent.count) })}
          tone={unsent.count > 0 ? "warn" : undefined}
          href="/finances?tab=draft"
        />
        <Kpi label={tr("Active customers")} value={whole(counts.active)} sub={tr("{net} in this period ({added} new, {lost} lost)", { net: `${net >= 0 ? "+" : ""}${net}`, added: counts.added, lost: counts.lost })} href={`/reports?tab=customers&${rq}`} />
        <Kpi
          label={tr("Visits completed")}
          value={whole(visits.completed)}
          change={change(visits.completed, visitsBefore.completed)}
          sub={tr("{pct} canceled", { pct: percent(cancelRate) })}
          href={`/reports?tab=operations&${rq}`}
        />
        <Kpi label={tr("Monthly recurring revenue")} value={moneyWhole(recurring.monthlyCents)} sub={tr("expected from recurring invoices")} href={`/reports?tab=operations&${rq}`} />
        <Kpi
          label={tr("Revenue per hour on site")}
          value={perHour.centsPerHour ? money(perHour.centsPerHour) : "—"}
          change={perHour.centsPerHour && perHourBefore.centsPerHour ? change(perHour.centsPerHour, perHourBefore.centsPerHour) : undefined}
          sub={plural(tr, perHour.visits, "{n} timed visit", "{n} timed visits", { n: whole(perHour.visits) })}
          href={`/reports?tab=pricing&${rq}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={tr("Collected vs invoiced")} text={tr("Paid invoices each month, and invoices finalized that month.")} className="lg:col-span-2">
          <BarChart
            label={tr("Collected and invoiced by month")}
            categories={months.map((m) => monthLabel(m, locale))}
            series={[
              { name: tr("Collected"), color: chartColors.green, values: months.map((m) => byMonth.find((x) => x.month === m)?.cents ?? 0) },
              { name: tr("Invoiced"), color: chartColors.blue, values: months.map((m) => invoicedByMonth.find((x) => x.month === m)?.cents ?? 0) },
            ]}
            format={moneyShort}
          />
        </Section>
        <Section title={tr("Needs attention")}>
          <ul className="grid gap-2.5 text-sm">
            {owed.pastDueInvoices > 0 && (
              <Attention href="/finances?tab=past_due">
                {plural(tr, owed.pastDueInvoices, "{n} past-due invoice", "{n} past-due invoices")} ({moneyWhole(owed.pastDue)})
              </Attention>
            )}
            {unbilled.count > 0 && (
              <Attention href={`/reports?tab=operations&${rq}#not-invoiced`}>
                {plural(tr, unbilled.count, "{n} completed visit without an invoice", "{n} completed visits without an invoice")}
              </Attention>
            )}
            {counts.lost > 0 && (
              <Attention href={`/reports?tab=customers&${rq}`}>
                {plural(tr, counts.lost, "{n} customer lost in this period", "{n} customers lost in this period")}
              </Attention>
            )}
            {vehicleIssues.map((v) => (
              <Attention key={v.id} href="/fleet?tab=maintenance">
                {v.name}:{" "}
                {[
                  v.milesLeft != null && v.milesLeft < 0 ? tr("service overdue") : v.milesLeft != null && v.milesLeft <= 500 ? tr("service due soon") : null,
                  v.milOn ? tr("check engine light") : null,
                  v.battery && v.battery !== "normal" ? tr("battery {state}", { state: tr(v.battery) }) : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </Attention>
            ))}
            {owed.pastDueInvoices === 0 && unbilled.count === 0 && counts.lost === 0 && vehicleIssues.length === 0 && (
              <li className="text-muted-foreground">{tr("Nothing needs attention.")}</li>
            )}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Attention({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
      <Link href={href} className={linkClass}>
        {children}
      </Link>
    </li>
  );
}

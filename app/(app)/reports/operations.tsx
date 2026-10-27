import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { BarChart, chartColors, HBars, Kpi } from "@/components/charts";
import { linkClass } from "@/components/record";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Formatters } from "@/lib/i18n/format";
import { phrase, plural } from "@/lib/i18n/tr";
import * as q from "@/lib/reports/queries";
import { daysIn, type Range, weeksBetween } from "@/lib/reports/range";
import { moneyWhole, percent, Section, whole } from "./shared";
import { getI18n } from "@/lib/i18n/server";

// (shown through tr())
const frequencyLabels: Record<string, string> = {
  weekly: phrase("Weekly"),
  biweekly: phrase("Every 2 weeks"),
  every_3_weeks: phrase("Every 3 weeks"),
  every_4_weeks: phrase("Every 4 weeks"),
  monthly: phrase("Monthly"),
  every_2_months: phrase("Every 2 months"),
  one_time: phrase("One time"),
};
// The work itself: visits (appointments) only. Money is on the Money tab.
export async function Operations({ range, fmt }: { range: Range; fmt: Formatters }) {
  const { tr } = await getI18n();
  const canInvoice = can(await getCurrentUser(), "invoices.create");
  const [weekly, counts, days, recurring, vehicles, unbilled] = await Promise.all([
    q.visitsByWeek(range),
    q.visitCounts(range),
    q.busiestWeekdays(range),
    q.recurringRevenue(),
    q.vehicleHours(range),
    q.notInvoiced(range, 50),
  ]);
  const firstWeek = weekly[0]?.week;
  const weeks = weeksBetween(firstWeek && firstWeek > range.from ? firstWeek : range.from, range.to).slice(-52);
  const at = (w: string) => weekly.find((x) => x.week === w);
  const cancelRate = counts.completed + counts.canceled ? counts.canceled / (counts.completed + counts.canceled) : 0;
  const weeksInRange = Math.max(1, daysIn(range) / 7);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={tr("Visits completed")} value={whole(counts.completed)} sub={tr("{n} a week on average", { n: (counts.completed / weeksInRange).toFixed(1) })} />
        <Kpi label={tr("Canceled")} value={whole(counts.canceled)} sub={tr("{pct} of visits", { pct: percent(cancelRate) })} tone={cancelRate > 0.1 ? "warn" : undefined} />
        <Kpi label={tr("Still pending")} value={whole(counts.pending)} sub={tr("booked in this period, not completed yet")} href="/appointments" />
        <Kpi label={tr("Monthly recurring revenue")} value={moneyWhole(recurring.monthlyCents)} sub={plural(tr, recurring.byFrequency.reduce((s, f) => s + f.plans, 0), "{n} recurring invoice", "{n} recurring invoices")} />
      </div>

      <Section title={tr("Visits per week")}>
        <BarChart
          label={tr("Visits per week")}
          stacked
          categories={weeks.map((w) => fmt.monthDay(w))}
          series={[
            { name: tr("visit|Completed"), color: chartColors.green, values: weeks.map((w) => at(w)?.completed ?? 0) },
            { name: tr("visit|Pending"), color: chartColors.blue, values: weeks.map((w) => at(w)?.pending ?? 0) },
            { name: tr("visit|Canceled"), color: chartColors.gray, values: weeks.map((w) => at(w)?.canceled ?? 0) },
          ]}
          format={whole}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={tr("Busiest days")} text={tr("Completed visits by day of the week.")}>
          <HBars rows={fmt.weekdays.long.map((d, i) => ({ label: d, value: days.find((x) => x.dow === i + 1)?.visits ?? 0 })).filter((r) => r.value > 0)} format={whole} />
        </Section>
        <Section title={tr("Recurring revenue")} text={tr("{amount} a month expected from active customers' recurring invoices (amount × visits a month).", { amount: moneyWhole(recurring.monthlyCents) })}>
          <HBars
            rows={recurring.byFrequency.filter((f) => f.plans > 0).map((f) => ({ label: frequencyLabels[f.frequency] ? tr(frequencyLabels[f.frequency]) : f.frequency, value: f.monthlyCents, sub: plural(tr, f.plans, "{n} plan", "{n} plans") }))}
            format={moneyWhole}
            color={chartColors.green}
          />
        </Section>
        <Section title={tr("Hours booked per vehicle")} text={tr("Scheduled hours of visits assigned to each vehicle, a week on average.")}>
          <HBars
            rows={vehicles.map((v) => ({ label: v.name, value: v.hours / weeksInRange, sub: plural(tr, v.visits, "{n} visit", "{n} visits") }))}
            format={(h) => tr("{n} h/week", { n: h.toFixed(1) })}
            empty={tr("No visits in this period have a vehicle assigned. Choose the vehicle when booking to see this.")}
          />
        </Section>
      </div>

      <Section
        id="not-invoiced"
        title={tr("Completed visits without an invoice")}
        text={
          unbilled.count === 0
            ? tr("Every completed visit in this period has a payment or an invoice.")
            : plural(
                tr,
                unbilled.count,
                "{n} completed visit with no payment recorded and no invoice linked. Some may have been paid under another visit.",
                "{n} completed visits with no payment recorded and no invoice linked. Some may have been paid under another visit.",
                { n: whole(unbilled.count) },
              )
        }
      >
        {unbilled.list.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("Visit")}</TableHead>
                  <TableHead>{tr("Customer")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {unbilled.list.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell data-primary>
                      <Link href={`/appointments/${v.id}`} className={linkClass}>
                        {fmt.day(v.start)}
                      </Link>
                    </TableCell>
                    <TableCell data-label={tr("Customer")} className="whitespace-normal">
                      <Link href={`/customers/${v.customer_id}`} className="hover:text-link">
                        {v.code} {v.name}
                      </Link>
                      <div className="text-[0.8rem] text-muted-foreground">{v.street}</div>
                    </TableCell>
                    <TableCell data-actions className="text-right">
                      {canInvoice && (
                        <Link href={`/finances/invoices/new?appointment=${v.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                          {tr("Create invoice")}
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {unbilled.count > unbilled.list.length && <p className="text-[0.8rem] text-muted-foreground">{tr("Showing the {n} most recent.", { n: unbilled.list.length })}</p>}
      </Section>
    </div>
  );
}

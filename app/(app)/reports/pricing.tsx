import Link from "next/link";
import { BarChart, chartColors, HBars, Kpi } from "@/components/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import * as q from "@/lib/reports/queries";
import { monthLabel, monthsBetween, type Range } from "@/lib/reports/range";
import { minutes, money, moneyShort, moneyWhole, Section, whole } from "./shared";
import { getI18n } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/tr";

// for a rough drive cost; change here if your cost per mile differs
const COST_PER_MILE_CENTS = 70;

export async function Pricing({ range }: { range: Range }) {
  const { tr, locale } = await getI18n();
  const [overall, byMonth, properties, miles] = await Promise.all([
    q.revenuePerHour(range),
    q.revenuePerHourByMonth(range),
    q.pricingByProperty(range, 100),
    q.driveMilesByCustomer(range, 15),
  ]);
  const firstMonth = byMonth[0]?.month;
  const months = monthsBetween(firstMonth && `${firstMonth}-01` > range.from ? `${firstMonth}-01` : range.from, range.to).slice(-24);
  const gpsShare = overall.visits ? overall.fromGps / overall.visits : 0;
  const median = (list: number[]) => {
    const s = [...list].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const typical = median(properties.map((p) => p.centsPerHour));

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label={tr("Revenue per hour on site")} value={overall.centsPerHour ? money(overall.centsPerHour) : "—"} sub={plural(tr, overall.visits, "{n} completed visit with times", "{n} completed visits with times", { n: whole(overall.visits) })} />
        <Kpi label={tr("Average time on site")} value={overall.avgMinutes ? minutes(overall.avgMinutes) : "—"} />
        <Kpi
          label={tr("Revenue per labor hour")}
          value={overall.centsPerLaborHour ? money(overall.centsPerLaborHour) : "—"}
          sub={overall.withCrew ? plural(tr, overall.withCrew, "{n} visit with a crew size", "{n} visits with a crew size") : tr("needs the crew size on visits")}
        />
      </div>
      <p className="rounded-lg border bg-secondary/40 px-4 py-2.5 text-sm">
        {gpsShare >= 0.5
          ? tr("Times on site come from vehicle GPS (Bouncie) for {pct}% of these visits.", { pct: Math.round(gpsShare * 100) })
          : tr("Most times on site here come from the calendar import, which records the booked times. As Bouncie records real arrivals and departures, these numbers (and the time over booked) become exact.")}
      </p>

      <Section title={tr("Revenue per hour by month")}>
        <BarChart
          label={tr("Revenue per hour on site by month")}
          categories={months.map((m) => monthLabel(m, locale))}
          series={[{ name: tr("Per hour on site"), color: chartColors.blue, values: months.map((m) => byMonth.find((x) => x.month === m)?.centsPerHour ?? 0) }]}
          format={moneyShort}
        />
      </Section>

      <Section
        title={tr("By property")}
        text={tr("Lowest revenue per hour first: the top of the list is the most likely to be underpriced. The typical property earns {amount} an hour.", { amount: typical ? money(typical) : "—" })}
      >
        {properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("No completed visits with times in this period.")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("Customer")}</TableHead>
                  <TableHead className="text-right">{tr("Visits")}</TableHead>
                  <TableHead className="text-right">{tr("Avg price")}</TableHead>
                  <TableHead className="text-right">{tr("Time on site")}</TableHead>
                  <TableHead className="text-right">{tr("Per hour")}</TableHead>
                  <TableHead className="text-right">{tr("Over booked time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((p) => (
                  <TableRow key={p.propertyId}>
                    <TableCell data-primary className="whitespace-normal">
                      <Link href={`/customers/${p.customerId}`} className="font-medium hover:text-link">
                        {p.code} {p.name}
                      </Link>
                      <div className="text-[0.8rem] text-muted-foreground">{p.street}</div>
                    </TableCell>
                    <TableCell data-label={tr("Visits")} className="text-right tabular-nums">{p.visits}</TableCell>
                    <TableCell data-label={tr("Avg price")} className="text-right tabular-nums">{money(p.avgPriceCents)}</TableCell>
                    <TableCell data-label={tr("Time on site")} className="text-right tabular-nums">{minutes(p.medianMinutes)}</TableCell>
                    <TableCell
                      data-label={tr("Per hour")}
                      className={cn("text-right font-medium tabular-nums", typical && p.centsPerHour < typical * 0.8 && "text-destructive")}
                    >
                      {money(p.centsPerHour)}
                    </TableCell>
                    <TableCell
                      data-label={tr("Over booked time")}
                      className={cn("text-right tabular-nums", p.avgOverMinutes > 15 && "text-amber-700 dark:text-amber-400")}
                    >
                      {p.avgOverMinutes > 0 ? `+${minutes(p.avgOverMinutes)}` : p.avgOverMinutes < 0 ? `−${minutes(-p.avgOverMinutes)}` : tr("on time")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title={tr("Drive cost per customer")} text={tr("Miles driven to each customer (Bouncie trips that ended at their property), at about {amount} a mile.", { amount: money(COST_PER_MILE_CENTS) })}>
        <HBars
          rows={miles.map((m) => ({
            label: `${m.code} ${m.name}`,
            value: m.miles,
            href: `/customers/${m.id}`,
            sub: tr("{trips} trips · ≈ {cost} · {miles} mi each", { trips: m.visits, cost: moneyWhole(m.miles * COST_PER_MILE_CENTS), miles: (m.miles / m.visits).toFixed(1) }),
          }))}
          format={(n) => `${n.toFixed(1)} mi`}
          color={chartColors.amber}
          empty={tr("No Bouncie trips to customers' properties in this period yet.")}
        />
      </Section>
    </div>
  );
}

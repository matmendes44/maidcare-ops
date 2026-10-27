import Link from "next/link";
import { BarChart, chartColors, Kpi } from "@/components/charts";
import { linkClass } from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import * as q from "@/lib/reports/queries";
import { monthLabel, monthsBetween, type Range } from "@/lib/reports/range";
import { percent, Section, whole } from "./shared";
import { getI18n } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/tr";

const palette = [chartColors.blue, chartColors.green, chartColors.amber, chartColors.gray];

export async function Fleet({ range }: { range: Range }) {
  const { tr, locale } = await getI18n();
  const [rows, onTime, vehicles] = await Promise.all([q.milesByVehicleMonth(range), q.onTimeByMonth(range), q.maintenanceDue()]);
  const names = [...new Set(rows.map((r) => r.vehicle))];
  const firstMonth = [...rows.map((r) => r.month), ...onTime.map((o) => o.month)].sort()[0];
  const months = monthsBetween(firstMonth && `${firstMonth}-01` > range.from ? `${firstMonth}-01` : range.from, range.to).slice(-24);
  const totals = names.map((n) => {
    const mine = rows.filter((r) => r.vehicle === n);
    return { name: n, miles: mine.reduce((s, r) => s + r.miles, 0), fuel: mine.reduce((s, r) => s + r.fuel, 0), trips: mine.reduce((s, r) => s + r.trips, 0) };
  });
  const gpsVisits = onTime.reduce((s, o) => s + o.visits, 0);
  const onTimeCount = onTime.reduce((s, o) => s + o.onTime, 0);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={tr("Miles driven")} value={whole(totals.reduce((s, t) => s + t.miles, 0))} sub={plural(tr, totals.reduce((s, t) => s + t.trips, 0), "{n} trip", "{n} trips", { n: whole(totals.reduce((s, t) => s + t.trips, 0)) })} href="/fleet?tab=mileage" />
        <Kpi label={tr("Fuel used")} value={`${totals.reduce((s, t) => s + t.fuel, 0).toFixed(1)} gal`} />
        <Kpi
          label={tr("Arrived on time")}
          value={gpsVisits ? percent(onTimeCount / gpsVisits) : "—"}
          sub={gpsVisits ? tr("{n} visits with GPS arrival times (within 5 minutes of the start)", { n: whole(gpsVisits) }) : tr("needs arrivals detected by Bouncie")}
        />
      </div>

      <Section title={tr("Miles per month")}>
        <BarChart
          label={tr("Miles per month by vehicle")}
          stacked
          categories={months.map((m) => monthLabel(m, locale))}
          series={names.map((n, i) => ({ name: n, color: palette[i % palette.length], values: months.map((m) => rows.find((r) => r.month === m && r.vehicle === n)?.miles ?? 0) }))}
          format={(n) => whole(n)}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={tr("On-time arrivals by month")} text={tr("Only visits whose arrival was detected by vehicle GPS.")}>
          {gpsVisits ? (
            <BarChart
              label={tr("Share of visits on time by month")}
              categories={months.map((m) => monthLabel(m, locale))}
              series={[{ name: tr("On time"), color: chartColors.green, values: months.map((m) => { const o = onTime.find((x) => x.month === m); return o && o.visits ? Math.round((o.onTime / o.visits) * 100) : 0; }) }]}
              format={(n) => `${Math.round(n)}%`}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{tr("No GPS arrivals yet. Once vans are assigned to visits, Bouncie trips fill this in.")}</p>
          )}
        </Section>
        <Section title={tr("Vehicles")}>
          <div className="overflow-hidden rounded-lg border">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("Vehicle")}</TableHead>
                  <TableHead className="text-right">{tr("Miles")}</TableHead>
                  <TableHead>{tr("Service")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell data-primary className="font-medium">{v.name}</TableCell>
                    <TableCell data-label={tr("Miles")} className="text-right tabular-nums">{whole(totals.find((t) => t.name === v.name)?.miles ?? 0)}</TableCell>
                    <TableCell data-label={tr("Service")} className="whitespace-normal">
                      <div className="flex flex-wrap gap-1.5">
                        {v.milesLeft == null ? (
                          <Badge variant="muted">{tr("No service recorded")}</Badge>
                        ) : v.milesLeft < 0 ? (
                          <Badge variant="destructive">{tr("Overdue {n} mi", { n: whole(-v.milesLeft) })}</Badge>
                        ) : (
                          <Badge variant={v.milesLeft <= 500 ? "outline" : "success"}>{tr("Due in {n} mi", { n: whole(v.milesLeft) })}</Badge>
                        )}
                        {v.milOn && <Badge variant="outline">{tr("Check engine")}</Badge>}
                        {v.battery && v.battery !== "normal" && <Badge variant="outline">{tr("Battery {state}", { state: tr(v.battery) })}</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Link href="/fleet?tab=maintenance" className={`${linkClass} text-sm`}>
            {tr("Record services on the Fleet page")}
          </Link>
        </Section>
      </div>
    </div>
  );
}

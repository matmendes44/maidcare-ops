import Link from "next/link";
import { BarChart, HBars, Kpi, chartColors } from "@/components/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { plural } from "@/lib/inventory/options";
import { getI18n } from "@/lib/i18n/server";
import { money, moneyShort, Section } from "../reports/shared";
import { completedVisits, getItems, usageByLocation, usageSince, weeklyUse, type Location } from "./data";

const spans = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];

// What's being used up, what it costs per cleaning, which vehicle goes
// through what, and what's lost or worn out.
export async function Usage({ today, days, locations, seeCosts }: { today: string; days: number; locations: Location[]; seeCosts: boolean }) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [{ fmt }, items, usage, weeks, byLoc, visits] = await Promise.all([getI18n(), getItems(), usageSince(from), weeklyUse(from), usageByLocation(from), completedVisits(from, today)]);
  const rows = items
    .map(({ item }) => ({ item, u: usage.get(item.id) }))
    .filter((r) => r.u && (r.u.used || r.u.writtenOff))
    .sort((a, b) => b.u!.costCents - a.u!.costCents || b.u!.used - a.u!.used);
  const cost = rows.reduce((s, r) => s + r.u!.costCents, 0);
  const lostCost = rows.reduce((s, r) => s + r.u!.writtenOff * (r.item.unitCostCents ?? 0), 0);
  const units = rows.reduce((s, r) => s + r.u!.used, 0);
  const name = (id: number | null) => locations.find((l) => l.id === id)?.name ?? "Unknown";

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap gap-1.5 text-sm" role="group" aria-label="Period">
        {spans.map((s) => (
          <Link key={s.days} href={`/inventory?tab=usage&days=${s.days}`} aria-current={s.days === days ? "true" : undefined} className={cn("rounded-md border px-2.5 py-1", s.days === days ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground hover:bg-secondary")}>
            Last {s.label}
          </Link>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {seeCosts && <Kpi label="Supplies used up or lost" value={money(cost)} sub={`${units} used · ${rows.reduce((s, r) => s + r.u!.writtenOff, 0)} lost or worn out`} />}
        {seeCosts && <Kpi label="Supply cost per cleaning" value={visits ? money(Math.round(cost / visits)) : "—"} sub={`${visits} completed visits`} />}
        {!seeCosts && <Kpi label="Units used" value={String(units)} />}
        <Kpi label="Cleanings per unit used" value={units ? (visits / units).toFixed(1) : "—"} sub="higher is leaner" />
        <Kpi label="Lost or worn out" value={seeCosts ? money(lostCost) : String(rows.reduce((s, r) => s + r.u!.writtenOff, 0))} tone={lostCost > 0 ? "warn" : undefined} sub="written off at counts" />
      </div>
      {seeCosts && (
        <Section title="Supply cost by week">
          <BarChart label="Cost of supplies used each week" categories={weeks.map((w) => fmt.calendarDate(w.week).replace(/, \d{4}$/, ""))} series={[{ name: "Used", values: weeks.map((w) => w.costCents), color: chartColors.blue }]} format={moneyShort} />
        </Section>
      )}
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Biggest users" text="Items by what was used (cost when known).">
          <HBars rows={rows.slice(0, 10).map((r) => ({ label: r.item.name, value: seeCosts ? r.u!.costCents : r.u!.used, href: `/inventory/items/${r.item.id}`, sub: plural(r.u!.used + r.u!.writtenOff, r.item.unit) }))} format={seeCosts ? money : (n) => String(n)} />
        </Section>
        <Section title="By location" text="Where things were used from: compare vehicles.">
          <HBars rows={byLoc.map((l) => ({ label: name(l.locationId), value: seeCosts ? l.costCents : l.units, sub: `${l.units} units` }))} format={seeCosts ? money : (n) => String(n)} color={chartColors.amber} />
        </Section>
      </div>
      <Section title="Every item">
        <div className="overflow-hidden rounded-lg border">
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Lost / worn out</TableHead>
                <TableHead className="text-right">Per cleaning</TableHead>
                {seeCosts && <TableHead className="text-right">Cost</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Nothing used in this period yet. Use is recorded when vehicles are restocked and stock is counted.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(({ item, u }) => (
                  <TableRow key={item.id}>
                    <TableCell data-primary>
                      <Link href={`/inventory/items/${item.id}`} className="font-medium hover:text-link">
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell data-label="Used" className="text-right tabular-nums">
                      {plural(u!.used, item.unit)}
                    </TableCell>
                    <TableCell data-label="Lost / worn out" className={cn("text-right tabular-nums", u!.writtenOff > 0 && "text-amber-700 dark:text-amber-400")}>
                      {u!.writtenOff || "—"}
                    </TableCell>
                    <TableCell data-label="Per cleaning" className="text-right tabular-nums">
                      {visits ? ((u!.used + u!.writtenOff) / visits).toFixed(2) : "—"}
                    </TableCell>
                    {seeCosts && (
                      <TableCell data-label="Cost" className="text-right tabular-nums">
                        {fmt.money(u!.costCents)}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}

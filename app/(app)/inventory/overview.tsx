import Link from "next/link";
import { Kpi } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { plural } from "@/lib/inventory/options";
import { serviceDue } from "@/lib/inventory/stock";
import { getI18n } from "@/lib/i18n/server";
import { Section } from "../reports/shared";
import { completedVisits, getAssets, getReports, parsFor, stockOverview, usageSince, type Location } from "./data";
import { ReportsInbox } from "./reports-inbox";

export async function Overview({ today, locations, manage, seeCosts }: { today: string; locations: Location[]; manage: boolean; seeCosts: boolean }) {
  const from30 = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const active = locations.filter((l) => l.isActive);
  const [{ fmt }, stock, assets, reports, usage, visits] = await Promise.all([getI18n(), stockOverview(today, locations), getAssets(), getReports(), usageSince(from30), completedVisits(from30, today)]);
  const toOrder = stock.filter((s) => s.suggestion);
  const lowOrOut = stock.filter((s) => s.status !== "ok");
  const vehicles = active.filter((l) => l.kind === "vehicle");
  const kits = await Promise.all(
    vehicles.map(async (v) => {
      const pars = await parsFor(v);
      const short = stock
        .map((s) => ({ s, par: pars.get(s.id) ?? 0, have: s.byLocation.get(v.id) ?? 0 }))
        .filter((x) => x.par > 0 && x.have < x.par);
      return { v, short, kitSize: pars.size };
    }),
  );
  const attention = assets
    .map((a) => ({ a, due: serviceDue(a.asset, a.serviceIntervalDays, today) }))
    .filter(({ a, due }) => a.asset.status === "needs_repair" || a.asset.status === "in_repair" || a.asset.status === "lost" || due?.overdue || due?.soon);
  const usedCost = [...usage.values()].reduce((s, u) => s + u.costCents, 0);
  const byVendor = new Map<string, typeof toOrder>();
  for (const s of toOrder) byVendor.set(s.vendorName ?? "No preferred store", [...(byVendor.get(s.vendorName ?? "No preferred store") ?? []), s]);

  return (
    <div className="grid gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Reported problems" value={String(reports.length)} tone={reports.length ? "warn" : undefined} sub="open" />
        <Kpi label="Low or out in storage" value={String(lowOrOut.length)} tone={lowOrOut.some((s) => s.status === "out") ? "bad" : lowOrOut.length ? "warn" : undefined} href="/inventory?tab=supplies&show=low" />
        <Kpi label="Vehicles to restock" value={`${kits.filter((k) => k.short.length).length} of ${vehicles.length}`} tone={kits.some((k) => k.short.length) ? "warn" : undefined} />
        {seeCosts ? (
          <Kpi label="Supplies used · 30 days" value={fmt.money(usedCost)} sub={visits ? `${fmt.money(Math.round(usedCost / visits))} per cleaning (${visits} visits)` : "no completed visits"} href="/inventory?tab=usage" />
        ) : (
          <Kpi label="Equipment needing attention" value={String(attention.length)} tone={attention.length ? "warn" : undefined} href="/inventory?tab=equipment" />
        )}
      </div>

      <Section title="Reported by cleaners" text={reports.length ? undefined : undefined}>
        <ReportsInbox reports={reports} fmt={fmt} manage={manage} />
      </Section>

      <Section title="Vehicle load-outs" text="What each vehicle is short of its kit. Restock counts what's in it and loads it back up from storage.">
        {vehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vehicles yet: they come from Bouncie (Fleet → Setup).</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {kits.map(({ v, short, kitSize }) => (
              <li key={v.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/inventory/locations/${v.id}`} className="font-semibold hover:text-link">
                    {v.name}
                  </Link>
                  {kitSize === 0 ? <Badge variant="muted">No kit set</Badge> : short.length ? <Badge variant="warning">{short.length} short</Badge> : <Badge variant="success">Stocked</Badge>}
                </div>
                {short.length > 0 && (
                  <ul className="mt-2 grid gap-0.5 text-sm">
                    {short.slice(0, 6).map(({ s, par, have }) => (
                      <li key={s.id} className="flex justify-between gap-2">
                        <span>{s.name}</span>
                        <span className={have === 0 ? "text-destructive tabular-nums" : "text-amber-700 tabular-nums dark:text-amber-400"}>
                          {have} / {par}
                        </span>
                      </li>
                    ))}
                    {short.length > 6 && <li className="text-muted-foreground">and {short.length - 6} more</li>}
                  </ul>
                )}
                {manage && (
                  <Link href={`/inventory/locations/${v.id}/count`} className={buttonVariants({ size: "sm", variant: short.length ? "default" : "outline", className: "mt-3" })}>
                    Restock
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Shopping list" text="Low in storage, or running out within a week at the current rate. Quantities cover about 30 days of use (at least the usual reorder amount).">
        {toOrder.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to order right now.</p>
        ) : (
          <div className="grid gap-4">
            {[...byVendor.entries()].map(([vendor, list]) => (
              <div key={vendor} className="overflow-hidden rounded-lg border">
                <div className="flex items-center justify-between bg-muted/50 px-4 py-2 text-sm font-semibold">
                  <span>{vendor}</span>
                  {seeCosts && <span className="font-normal text-muted-foreground">about {fmt.money(list.reduce((s, x) => s + (x.unitCostCents ?? 0) * x.suggestion!.quantity, 0))}</span>}
                </div>
                <ul className="divide-y text-sm">
                  {list.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
                      <Link href={`/inventory/items/${s.id}`} className="font-medium hover:text-link">
                        {s.name}
                      </Link>
                      <span className="text-muted-foreground">{s.suggestion!.reasons.join(", ")}</span>
                      <span className="ml-auto font-medium tabular-nums">Buy {plural(s.suggestion!.quantity, s.unit)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {manage && (
              <div className="flex gap-2">
                <Link href="/inventory/receive" className={buttonVariants({ size: "sm" })}>
                  Receive what you bought
                </Link>
                <Link href="/inventory/shopping-list" className={buttonVariants({ size: "sm", variant: "outline" })}>
                  Printable list
                </Link>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Equipment needing attention">
        {attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">All equipment is in service and up to date.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {attention.map(({ a, due }) => (
              <li key={a.asset.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <Link href={`/inventory/assets/${a.asset.id}`} className="font-medium hover:text-link">
                  {a.itemName} <span className="font-mono text-[0.8rem] text-muted-foreground">{a.asset.assetTag}</span>
                </Link>
                <span className="text-muted-foreground">{a.locationName}</span>
                <span className="ml-auto flex gap-1.5">
                  {a.asset.status === "needs_repair" && <Badge variant="warning">Needs repair</Badge>}
                  {a.asset.status === "in_repair" && <Badge variant="info">In repair</Badge>}
                  {a.asset.status === "lost" && <Badge variant="destructive">Lost</Badge>}
                  {due?.overdue && <Badge variant="destructive">Service overdue</Badge>}
                  {due?.soon && <Badge variant="warning">Service due {fmt.calendarDate(due.dueOn)}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

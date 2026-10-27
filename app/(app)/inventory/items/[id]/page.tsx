import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Boxes, Pencil, Plus } from "lucide-react";
import { BarChart, Kpi, chartColors } from "@/components/charts";
import { PageLoading } from "@/components/page-loading";
import { RecordType, linkClass } from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { assetStatuses, itemCategories, itemKinds, movementKinds, plural, type AssetStatus, type ItemCategory, type MovementKind } from "@/lib/inventory/options";
import { daysLeft, reorder, statusStyle, stockStatus } from "@/lib/inventory/stock";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { recordMovement } from "../../actions";
import { getAssets, getItem, getLocations, getReports, movementsFor, parseId, parsFor, stockLevels, usageSince, weeklyUse } from "../../data";
import { ReportsInbox } from "../../reports-inbox";
import { MovementForm } from "./movement-form";

const saved: Record<string, string> = { created: "Item added.", updated: "Changes saved." };

async function ItemRecord({ params, searchParams }: Pick<PageProps<"/inventory/items/[id]">, "params" | "searchParams">) {
  const id = parseId((await params).id);
  const row = id === null ? null : await getItem(id);
  if (!row) notFound();
  const [sp, user, day, { fmt }] = await Promise.all([searchParams, getCurrentUser(), today(), getI18n()]);
  const item = row.item;
  const manage = can(user, "inventory.manage");
  const seeCosts = can(user, "expenses.view");
  const from30 = new Date(Date.parse(`${day}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const from12w = new Date(Date.parse(`${day}T00:00:00Z`) - 83 * 86_400_000).toISOString().slice(0, 10);
  const [locations, levels, usage, weeks, movements, reports, assets] = await Promise.all([
    getLocations(),
    stockLevels([item.id]),
    usageSince(from30),
    weeklyUse(from12w, item.id),
    movementsFor({ itemId: item.id }, 60),
    getReports(),
    item.kind === "equipment" ? getAssets() : Promise.resolve([]),
  ]);
  const byLoc = levels.get(item.id) ?? new Map<number, number>();
  const active = locations.filter((l) => l.isActive || (byLoc.get(l.id) ?? 0) !== 0);
  const pars = new Map(await Promise.all(active.map(async (l) => [l.id, (await parsFor(l)).get(item.id) ?? 0] as const)));
  const total = [...byLoc.values()].reduce((a, b) => a + b, 0);
  const storage = active.filter((l) => l.kind === "storage").reduce((s, l) => s + (byLoc.get(l.id) ?? 0), 0);
  const u = usage.get(item.id);
  const used30 = (u?.used ?? 0) + (u?.writtenOff ?? 0);
  const perDay = used30 / 30;
  const status = stockStatus(storage, item.reorderPoint);
  const suggestion = reorder({ totalOnHand: total, storageOnHand: storage, reorderPoint: item.reorderPoint, reorderQuantity: item.reorderQuantity, perDay });
  const left = daysLeft(total, perDay);
  const mine = reports.filter((r) => r.report.itemId === item.id);
  const units = assets.filter((a) => a.asset.itemId === item.id);
  const counted = item.kind !== "equipment";

  return (
    <>
      {typeof sp.saved === "string" && saved[sp.saved] && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {saved[sp.saved]}
        </p>
      )}
      <RecordType icon={Boxes}>{itemKinds[item.kind].label}</RecordType>
      <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-3xl font-bold">
        {item.name}
        {counted && <Badge variant={statusStyle[status].variant} className="h-7 px-3 text-[0.8rem]">{statusStyle[status].label}</Badge>}
        {!item.isActive && <Badge variant="muted">Inactive</Badge>}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {itemCategories[item.category as ItemCategory]}
        {counted && ` · counted by ${item.unit}`}
        {item.sku && ` · SKU ${item.sku}`}
        {row.vendorName && ` · usually from ${row.vendorName}`}
        {seeCosts && item.unitCostCents != null && ` · ${fmt.money(item.unitCostCents)} each`}
      </p>
      {manage && (
        <div className="mt-4 flex flex-wrap gap-2 border-b pb-4">
          <Link href={`/inventory/items/${item.id}/edit`} className={buttonVariants()}>
            <Pencil aria-hidden="true" />
            Edit
          </Link>
          {counted ? (
            <Link href="/inventory/receive" className={buttonVariants({ variant: "outline" })}>
              Receive stock
            </Link>
          ) : (
            <Link href={`/inventory/assets/new?item=${item.id}`} className={buttonVariants({ variant: "outline" })}>
              <Plus aria-hidden="true" />
              Add a unit
            </Link>
          )}
        </div>
      )}

      {counted ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="On hand" value={plural(total, item.unit)} sub={`${storage} in storage`} />
            <Kpi label="Used · 30 days" value={String(used30)} sub={perDay ? `about ${(perDay * 7).toFixed(1)} a week` : "none recorded"} />
            <Kpi label="Lasts" value={left === null ? "—" : `${left} days`} tone={left !== null && left < 7 ? "bad" : undefined} sub="at the recent rate" />
            <Kpi label="Reorder" value={suggestion ? `Buy ${suggestion.quantity}` : "Not yet"} tone={suggestion ? "warn" : undefined} sub={suggestion ? suggestion.reasons.join(", ") : `at ${item.reorderPoint} in storage`} />
          </div>

          <section className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">Where it is</h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((l) => {
                const have = byLoc.get(l.id) ?? 0;
                const par = pars.get(l.id) ?? 0;
                return (
                  <li key={l.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <Link href={`/inventory/locations/${l.id}`} className="hover:text-link">
                      {l.name}
                    </Link>
                    <span className={cn("tabular-nums", par > 0 && have < par && (have === 0 ? "text-destructive" : "text-amber-700 dark:text-amber-400"))}>
                      {have}
                      {par > 0 && <span className="text-muted-foreground"> / {par}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {manage && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold">Record a change</h2>
              <MovementForm action={recordMovement.bind(null, item.id)} locations={active.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name, qty: byLoc.get(l.id) ?? 0 }))} />
            </section>
          )}

          <section className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">Use by week</h2>
            <BarChart
              label={`${item.name} used each week`}
              stacked
              categories={weeks.map((w) => fmt.calendarDate(w.week).replace(/, \d{4}$/, ""))}
              series={[
                { name: "Used", values: weeks.map((w) => w.used), color: chartColors.blue },
                { name: "Lost / worn out", values: weeks.map((w) => w.writtenOff), color: chartColors.amber },
              ]}
              format={(n) => String(Math.round(n))}
            />
          </section>
        </>
      ) : (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Units ({units.length})</h2>
          {units.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No units yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {units.map((a) => (
                <li key={a.asset.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2">
                  <Link href={`/inventory/assets/${a.asset.id}`} className={linkClass}>
                    {a.asset.assetTag}
                  </Link>
                  <span className="text-muted-foreground">{a.locationName}</span>
                  <Badge variant={assetStatuses[a.asset.status as AssetStatus].variant}>{assetStatuses[a.asset.status as AssetStatus].label}</Badge>
                  {a.asset.serialNumber && <span className="ml-auto text-muted-foreground">Serial {a.asset.serialNumber}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mine.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Reported</h2>
          <ReportsInbox reports={mine} fmt={fmt} manage={manage} />
        </section>
      )}

      {counted && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">History</h2>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {movements.map(({ movement: m, fromName, toName, byName }) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
                  <span className="w-36 text-muted-foreground">{fmt.stamp(m.createdAt)}</span>
                  <span className="font-medium">{movementKinds[m.kind as MovementKind]}</span>
                  <span className="tabular-nums">{plural(m.quantity, item.unit)}</span>
                  <span className="text-muted-foreground">{m.kind === "transfer" ? `${fromName} → ${toName}` : (fromName ?? toName)}</span>
                  {m.note && <span className="text-muted-foreground">· {m.note}</span>}
                  {m.expenseId && seeCosts && (
                    <Link href={`/finances/expenses/${m.expenseId}`} className={linkClass}>
                      expense
                    </Link>
                  )}
                  <span className="ml-auto text-[0.75rem] text-muted-foreground">{byName ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {item.notes && <p className="mt-8 rounded-lg border bg-secondary/30 px-4 py-3 text-sm whitespace-pre-wrap">{item.notes}</p>}
    </>
  );
}

export default function ItemPage(props: PageProps<"/inventory/items/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ItemRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

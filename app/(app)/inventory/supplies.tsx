import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { itemCategories, itemCategoryKeys, itemKinds, type ItemCategory } from "@/lib/inventory/options";
import { daysLeft, statusStyle } from "@/lib/inventory/stock";
import { getI18n } from "@/lib/i18n/server";
import { parsFor, stockOverview, type Location } from "./data";

// Every supply and reusable item, how many are in storage and in each vehicle
// (red when a vehicle is under its kit), and how fast it's going.
export async function Supplies({ today, locations, category, show, seeCosts }: { today: string; locations: Location[]; category?: string; show?: string; seeCosts: boolean }) {
  const active = locations.filter((l) => l.isActive);
  const [{ fmt }, all] = await Promise.all([getI18n(), stockOverview(today, locations)]);
  const pars = new Map(await Promise.all(active.map(async (l) => [l.id, await parsFor(l)] as const)));
  const rows = all
    .filter((s) => !category || s.category === category)
    .filter((s) => show !== "low" || s.status !== "ok" || s.suggestion);
  const href = (c?: string, s?: string) => `/inventory?tab=supplies${c ? `&category=${c}` : ""}${s ? `&show=${s}` : ""}`;
  const used = new Set(all.map((s) => s.category));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
        <Link href={href(undefined, show)} aria-current={!category ? "true" : undefined} className={cn("rounded-md border px-2.5 py-1", !category ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground hover:bg-secondary")}>
          All
        </Link>
        {itemCategoryKeys
          .filter((c) => used.has(c))
          .map((c) => (
            <Link key={c} href={href(c, show)} aria-current={category === c ? "true" : undefined} className={cn("rounded-md border px-2.5 py-1", category === c ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground hover:bg-secondary")}>
              {itemCategories[c]}
            </Link>
          ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Link href={href(category, show === "low" ? undefined : "low")} aria-current={show === "low" ? "true" : undefined} className={cn("rounded-md border px-2.5 py-1", show === "low" ? "border-amber-500 bg-amber-50 font-medium dark:bg-amber-950/40" : "text-muted-foreground hover:bg-secondary")}>
          Needs attention only
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              {active.map((l) => (
                <TableHead key={l.id} className="text-right">
                  <Link href={`/inventory/locations/${l.id}`} className="hover:text-foreground">
                    {l.name}
                  </Link>
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Used / week</TableHead>
              <TableHead className="text-right">Lasts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={active.length + 5} className="py-10 text-center text-muted-foreground">
                  {all.length ? "Nothing needs attention." : "No supplies yet. Add the things you stock: refills, paper towels, chemicals, cloths."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => {
                const left = daysLeft(s.total, s.perDay);
                return (
                  <TableRow key={s.id} className="relative cursor-pointer">
                    <TableCell data-primary>
                      <Link href={`/inventory/items/${s.id}`} className="font-semibold text-foreground after:absolute after:inset-0 hover:text-link">
                        {s.name}
                      </Link>
                      <div className="text-[0.8rem] text-muted-foreground">
                        {itemCategories[s.category as ItemCategory]} · {itemKinds[s.kind].label.toLowerCase()} · per {s.unit}
                        {seeCosts && s.unitCostCents != null && ` · ${fmt.money(s.unitCostCents)}`}
                      </div>
                    </TableCell>
                    <TableCell data-label="Status">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={statusStyle[s.status].variant}>{statusStyle[s.status].label}</Badge>
                        {s.suggestion && s.status === "ok" && <Badge variant="warning">Order soon</Badge>}
                      </div>
                    </TableCell>
                    {active.map((l) => {
                      const have = s.byLocation.get(l.id) ?? 0;
                      const par = pars.get(l.id)?.get(s.id) ?? 0;
                      const short = par > 0 && have < par;
                      return (
                        <TableCell key={l.id} data-label={l.name} className={cn("text-right tabular-nums", short && (have === 0 ? "text-destructive" : "text-amber-700 dark:text-amber-400"), !have && !par && "text-muted-foreground/60")}>
                          {have}
                          {par > 0 && <span className="text-[0.75rem] text-muted-foreground">/{par}</span>}
                        </TableCell>
                      );
                    })}
                    <TableCell data-label="Total" className="text-right font-medium tabular-nums">
                      {s.total}
                    </TableCell>
                    <TableCell data-label="Used / week" className="text-right tabular-nums">
                      {s.perDay ? (s.perDay * 7).toFixed(s.perDay * 7 < 10 ? 1 : 0) : "—"}
                    </TableCell>
                    <TableCell data-label="Lasts" className={cn("text-right tabular-nums", left !== null && left < 7 && "text-destructive")}>
                      {left === null ? "—" : left > 365 ? "1 yr+" : `${left} days`}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-[0.8rem] text-muted-foreground">
        Numbers after a slash are the kit (how many should be there). Status is for storage: low at or under the reorder point. Use per week and how long stock lasts come from the last 30 days.
      </p>
    </>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assetStatuses, type AssetStatus } from "@/lib/inventory/options";
import { bookValue, serviceDue } from "@/lib/inventory/stock";
import { getI18n } from "@/lib/i18n/server";
import { getAssets } from "./data";

// Every piece of equipment: where it is, its status, service and value.
export async function Equipment({ today, seeCosts, showRetired }: { today: string; seeCosts: boolean; showRetired: boolean }) {
  const [{ fmt }, all] = await Promise.all([getI18n(), getAssets()]);
  const rows = all.filter((a) => showRetired || (a.asset.status !== "retired" && a.asset.status !== "lost"));
  const gone = all.length - all.filter((a) => a.asset.status !== "retired" && a.asset.status !== "lost").length;
  const totalCost = rows.reduce((s, a) => s + a.asset.purchaseCostCents, 0);
  const totalValue = rows.reduce((s, a) => s + bookValue(a.asset.purchaseCostCents, a.asset.purchasedOn, a.usefulLifeMonths, today), 0);
  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead>Equipment</TableHead>
              <TableHead>Where</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Service</TableHead>
              {seeCosts && <TableHead className="text-right">Cost / value</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No equipment yet. Add vacuums, steamers and other machines one by one so each has a tag and a location.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((a) => {
                const due = serviceDue(a.asset, a.serviceIntervalDays, today);
                const st = assetStatuses[a.asset.status as AssetStatus];
                return (
                  <TableRow key={a.asset.id} className="relative cursor-pointer">
                    <TableCell data-label="Tag" className="font-mono text-[0.85rem]">
                      {a.asset.assetTag}
                    </TableCell>
                    <TableCell data-primary>
                      <Link href={`/inventory/assets/${a.asset.id}`} className="font-semibold text-foreground after:absolute after:inset-0 hover:text-link">
                        {a.itemName}
                      </Link>
                      {a.asset.serialNumber && <div className="text-[0.8rem] text-muted-foreground">Serial {a.asset.serialNumber}</div>}
                    </TableCell>
                    <TableCell data-label="Where">{a.locationName}</TableCell>
                    <TableCell data-label="Status">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={st.variant}>{st.label}</Badge>
                        {a.openReports > 0 && <Badge variant="warning">{a.openReports} reported</Badge>}
                      </div>
                    </TableCell>
                    <TableCell data-label="Service">
                      {!due ? <span className="text-muted-foreground">—</span> : due.overdue ? <Badge variant="destructive">Overdue</Badge> : due.soon ? <Badge variant="warning">Due {fmt.calendarDate(due.dueOn)}</Badge> : <span className="text-muted-foreground">{fmt.calendarDate(due.dueOn)}</span>}
                    </TableCell>
                    {seeCosts && (
                      <TableCell data-label="Cost / value" className="text-right tabular-nums">
                        {fmt.money(a.asset.purchaseCostCents)}
                        {a.usefulLifeMonths && <div className="text-[0.8rem] text-muted-foreground">now {fmt.money(bookValue(a.asset.purchaseCostCents, a.asset.purchasedOn, a.usefulLifeMonths, today))}</div>}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-[0.8rem] text-muted-foreground">
        <span>
          {rows.length} pieces{seeCosts && ` · bought for ${fmt.money(totalCost)} · worth about ${fmt.money(totalValue)} now (straight-line over each item's useful life)`}
        </span>
        {gone > 0 && (
          <Link href={showRetired ? "/inventory?tab=equipment" : "/inventory?tab=equipment&retired=1"} className="text-link hover:underline">
            {showRetired ? "Hide retired and lost" : `Show ${gone} retired or lost`}
          </Link>
        )}
      </div>
    </>
  );
}

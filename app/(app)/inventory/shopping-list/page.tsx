import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { plural } from "@/lib/inventory/options";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { PrintButton } from "../../finances/expenses/report/print-button";
import { getLocations, stockOverview } from "../data";

// The shopping list, by store, to print or take on a phone.
async function ShoppingList() {
  const [user, day, { fmt }] = await Promise.all([getCurrentUser(), today(), getI18n()]);
  const seeCosts = can(user, "expenses.view");
  const list = (await stockOverview(day, await getLocations())).filter((s) => s.suggestion);
  const byVendor = new Map<string, typeof list>();
  for (const s of list) byVendor.set(s.vendorName ?? "Any store", [...(byVendor.get(s.vendorName ?? "Any store") ?? []), s]);
  return (
    <article className="max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/inventory" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Inventory
        </Link>
        <div className="flex gap-2">
          {can(user, "inventory.manage") && list.length > 0 && (
            <Link href="/inventory/receive?from=list" className={buttonVariants({ variant: "outline" })}>
              Receive these
            </Link>
          )}
          <PrintButton />
        </div>
      </div>
      <h1 className="text-2xl font-bold">Shopping list</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{fmt.calendarDate(day)}</p>
      {list.length === 0 ? (
        <p>Nothing to buy right now.</p>
      ) : (
        [...byVendor.entries()].map(([vendor, items]) => (
          <section key={vendor} className="mb-6 break-inside-avoid">
            <h2 className="mb-2 border-b pb-1 text-lg font-semibold">{vendor}</h2>
            <ul className="grid gap-1.5">
              {items.map((s) => (
                <li key={s.id} className="flex items-baseline gap-3">
                  <span className="inline-block size-4 shrink-0 rounded border" aria-hidden="true" />
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-muted-foreground">{s.suggestion!.reasons.join(", ")}</span>
                  <span className="ml-auto tabular-nums">{plural(s.suggestion!.quantity, s.unit)}</span>
                  {seeCosts && s.unitCostCents != null && <span className="w-20 text-right text-sm text-muted-foreground tabular-nums">~{fmt.money(s.unitCostCents * s.suggestion!.quantity)}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </article>
  );
}

export default function ShoppingListPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ShoppingList />
    </Suspense>
  );
}

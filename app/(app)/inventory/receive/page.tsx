import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { lastPaymentUsed } from "../../finances/expenses/data";
import { NoAccess } from "../../finances/no-access";
import { getVendorOptions } from "../../finances/vendors/data";
import { receiveStock } from "../actions";
import { getItems, getLocations, recentExpenses, stockOverview } from "../data";
import { ReceiveForm } from "./receive-form";

// ?from=list fills in the shopping list's suggestions.
async function Receive({ searchParams }: Pick<PageProps<"/inventory/receive">, "searchParams">) {
  const user = await getCurrentUser();
  if (!can(user, "inventory.manage") || !can(user, "expenses.manage")) return <NoAccess what="this page" />;
  const [sp, items, locations, vendors, expenses, day, last, { fmt }] = await Promise.all([searchParams, getItems(), getLocations(), getVendorOptions(), recentExpenses(), today(), lastPaymentUsed(), getI18n()]);
  const fromList = sp.from === "list" ? (await stockOverview(day, locations)).filter((s) => s.suggestion).map((s) => ({ itemId: s.id, qty: s.suggestion!.quantity })) : [];
  const active = locations.filter((l) => l.isActive);
  return (
    <>
      <Link href="/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Inventory
      </Link>
      <h1 className="text-3xl font-bold">Receive stock</h1>
      <p className="mt-1 text-sm text-muted-foreground">After a delivery or a shopping trip: adds the stock and records (or links) the expense, and updates each item&apos;s cost.</p>
      <ReceiveForm
        action={receiveStock}
        items={items.filter((r) => r.item.kind !== "equipment").map((r) => ({ id: r.item.id, name: r.item.name, unit: r.item.unit, unitCostCents: r.item.unitCostCents }))}
        locations={[...active.filter((l) => l.kind === "storage"), ...active.filter((l) => l.kind !== "storage")]}
        vendors={vendors}
        expenses={expenses.map((e) => ({ id: e.id, label: `${fmt.calendarDate(e.expenseDate)} · ${e.vendorName} · ${fmt.money(e.amountCents)}` }))}
        today={day}
        defaultMethod={last.paymentMethod}
        start={fromList}
      />
    </>
  );
}

export default function ReceivePage(props: PageProps<"/inventory/receive">) {
  return (
    <div className="max-w-3xl">
      <Suspense fallback={<PageLoading />}>
        <Receive searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

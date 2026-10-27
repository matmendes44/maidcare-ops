import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { today } from "@/lib/today";
import { getI18n } from "@/lib/i18n/server";
import { lastPaymentUsed } from "../../../finances/expenses/data";
import { NoAccess } from "../../../finances/no-access";
import { getVendorOptions } from "../../../finances/vendors/data";
import { createAsset } from "../../actions";
import { getItems, getLocations, recentExpenses } from "../../data";
import { AssetForm } from "../asset-form";

async function NewAsset({ searchParams }: Pick<PageProps<"/inventory/assets/new">, "searchParams">) {
  const user = await getCurrentUser();
  // equipment is tied to an expense, so this needs both
  if (!can(user, "inventory.manage") || !can(user, "expenses.manage")) return <NoAccess what="this page" />;
  const [sp, items, locations, vendors, expenses, day, last, { fmt }] = await Promise.all([searchParams, getItems(), getLocations(), getVendorOptions(), recentExpenses(), today(), lastPaymentUsed(), getI18n()]);
  return (
    <>
      <Link href="/inventory?tab=equipment" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Equipment
      </Link>
      <h1 className="text-3xl font-bold">Add equipment</h1>
      <p className="mt-1 text-sm text-muted-foreground">One unit at a time, each with where it&apos;s kept and the purchase it came from.</p>
      <AssetForm
        action={createAsset}
        items={items.filter((r) => r.item.kind === "equipment").map((r) => ({ id: r.item.id, name: r.item.name }))}
        locations={locations.filter((l) => l.isActive)}
        vendors={vendors}
        expenses={expenses.map((e) => ({ id: e.id, label: `${fmt.calendarDate(e.expenseDate)} · ${e.vendorName} · ${fmt.money(e.amountCents)}${e.description ? ` · ${e.description.slice(0, 40)}` : ""}` }))}
        today={day}
        defaultMethod={last.paymentMethod}
        initialItem={typeof sp.item === "string" ? sp.item : ""}
      />
    </>
  );
}

export default function NewAssetPage(props: PageProps<"/inventory/assets/new">) {
  return (
    <div className="max-w-3xl">
      <Suspense fallback={<PageLoading />}>
        <NewAsset searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

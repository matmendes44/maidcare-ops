import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { NoAccess } from "../../../finances/no-access";
import { getVendorOptions } from "../../../finances/vendors/data";
import { createItem } from "../../actions";
import { getLocations } from "../../data";
import { ItemForm } from "../item-form";

async function NewItem({ searchParams }: Pick<PageProps<"/inventory/items/new">, "searchParams">) {
  const user = await getCurrentUser();
  if (!can(user, "inventory.manage")) return <NoAccess what="this page" />;
  const [sp, locations, vendors] = await Promise.all([searchParams, getLocations(), can(user, "expenses.view") ? getVendorOptions() : Promise.resolve([])]);
  const kind = sp.kind === "equipment" ? "equipment" : "supply";
  return (
    <>
      <Link href="/inventory?tab=supplies" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Inventory
      </Link>
      <h1 className="text-3xl font-bold">Add item</h1>
      <ItemForm
        mode="create"
        action={createItem}
        cancelHref="/inventory?tab=supplies"
        vendors={vendors.filter((v) => v.isActive).map((v) => ({ id: v.id, label: `${v.code} ${v.name}` }))}
        storages={locations.filter((l) => l.kind === "storage" && l.isActive)}
        initialValues={{ name: "", kind, category: "", unit: "each", sku: "", vehiclePar: "0", reorderPoint: "0", reorderQuantity: "0", unitCost: "", preferredVendorId: "", serviceIntervalDays: "", usefulLifeMonths: "", notes: "", isActive: "true" }}
      />
    </>
  );
}

export default function NewItemPage(props: PageProps<"/inventory/items/new">) {
  return (
    <div className="max-w-3xl">
      <Suspense fallback={<PageLoading />}>
        <NewItem searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

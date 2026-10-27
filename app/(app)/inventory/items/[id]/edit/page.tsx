import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { NoAccess } from "../../../../finances/no-access";
import { getVendorOptions } from "../../../../finances/vendors/data";
import { updateItem } from "../../../actions";
import { getItem, parseId } from "../../../data";
import { ItemForm } from "../../item-form";

async function EditItem({ params }: Pick<PageProps<"/inventory/items/[id]/edit">, "params">) {
  const user = await getCurrentUser();
  if (!can(user, "inventory.manage")) return <NoAccess what="this page" />;
  const id = parseId((await params).id);
  const row = id === null ? null : await getItem(id);
  if (!row) notFound();
  const vendors = can(user, "expenses.view") ? await getVendorOptions() : [];
  const i = row.item;
  return (
    <>
      <Link href={`/inventory/items/${i.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {i.name}
      </Link>
      <h1 className="text-3xl font-bold">Edit item</h1>
      <ItemForm
        mode="edit"
        action={updateItem.bind(null, i.id)}
        cancelHref={`/inventory/items/${i.id}`}
        vendors={vendors.filter((v) => v.isActive || v.id === i.preferredVendorId).map((v) => ({ id: v.id, label: `${v.code} ${v.name}` }))}
        storages={[]}
        initialValues={{
          name: i.name,
          kind: i.kind,
          category: i.category,
          unit: i.unit,
          sku: i.sku ?? "",
          vehiclePar: String(i.vehiclePar),
          reorderPoint: String(i.reorderPoint),
          reorderQuantity: String(i.reorderQuantity),
          unitCost: i.unitCostCents != null ? (i.unitCostCents / 100).toFixed(2) : "",
          preferredVendorId: i.preferredVendorId ? String(i.preferredVendorId) : "",
          serviceIntervalDays: i.serviceIntervalDays ? String(i.serviceIntervalDays) : "",
          usefulLifeMonths: i.usefulLifeMonths ? String(i.usefulLifeMonths) : "",
          notes: i.notes ?? "",
          isActive: String(i.isActive),
        }}
      />
    </>
  );
}

export default function EditItemPage(props: PageProps<"/inventory/items/[id]/edit">) {
  return (
    <div className="max-w-3xl">
      <Suspense fallback={<PageLoading />}>
        <EditItem params={props.params} />
      </Suspense>
    </div>
  );
}

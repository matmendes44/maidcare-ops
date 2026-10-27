import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { FormField } from "@/components/form-field";
import { PageLoading } from "@/components/page-loading";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { NoAccess } from "../../../../finances/no-access";
import { updateAsset } from "../../../actions";
import { ActionForm, Submit } from "../../../action-form";
import { getAsset, parseId } from "../../../data";

async function EditAsset({ params }: Pick<PageProps<"/inventory/assets/[id]/edit">, "params">) {
  if (!can(await getCurrentUser(), "inventory.manage")) return <NoAccess what="this page" />;
  const id = parseId((await params).id);
  const a = id === null ? null : await getAsset(id);
  if (!a) notFound();
  return (
    <>
      <Link
        href={`/inventory/assets/${a.asset.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {a.asset.assetTag} {a.itemName}
      </Link>
      <h1 className="text-3xl font-bold">Edit equipment</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Move it or change its status from its page. The purchase stays linked to its expense.
      </p>
      <ActionForm action={updateAsset.bind(null, a.asset.id)} className="mt-6 gap-4">
        <FormField id="serialNumber" label="Serial number">
          <Input id="serialNumber" name="serialNumber" defaultValue={a.asset.serialNumber ?? ""} />
        </FormField>
        <FormField id="warrantyUntil" label="Warranty until">
          <Input id="warrantyUntil" name="warrantyUntil" type="date" defaultValue={a.asset.warrantyUntil ?? ""} />
        </FormField>
        <FormField id="assetCost" label="Cost">
          <Input id="assetCost" name="assetCost" inputMode="decimal" defaultValue={(a.asset.purchaseCostCents / 100).toFixed(2)} />
        </FormField>
        <FormField id="notes" label="Notes">
          <Textarea id="notes" name="notes" rows={3} defaultValue={a.asset.notes ?? ""} />
        </FormField>
        <div>
          <Submit>Save changes</Submit>
        </div>
      </ActionForm>
    </>
  );
}

export default function EditAssetPage(props: PageProps<"/inventory/assets/[id]/edit">) {
  return (
    <div className="max-w-xl">
      <Suspense fallback={<PageLoading />}>
        <EditAsset params={props.params} />
      </Suspense>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { NoAccess } from "../../../no-access";
import { updateVendor } from "../../actions";
import { getVendor, parseVendorId } from "../../data";
import { VendorForm } from "../../vendor-form";

async function EditVendor({ params }: Pick<PageProps<"/finances/vendors/[id]/edit">, "params">) {
  if (!can(await getCurrentUser(), "expenses.manage")) return <NoAccess what="this page" />;
  const id = parseVendorId((await params).id);
  const v = id === null ? null : await getVendor(id);
  if (!v) notFound();
  return (
    <>
      <Link href={`/finances/vendors/${v.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {v.vendorCode} {v.name}
      </Link>
      <h1 className="text-3xl font-bold">Edit vendor</h1>
      <VendorForm
        mode="edit"
        action={updateVendor.bind(null, v.id)}
        cancelHref={`/finances/vendors/${v.id}`}
        initialValues={{
          vendorCode: v.vendorCode,
          name: v.name,
          defaultCategory: v.defaultCategory ?? "",
          contactName: v.contactName ?? "",
          email: v.email ?? "",
          phone: v.phone ?? "",
          website: v.website ?? "",
          address: v.address ?? "",
          accountNumber: v.accountNumber ?? "",
          notes: v.notes ?? "",
          isActive: String(v.isActive),
        }}
      />
    </>
  );
}

export default function EditVendorPage(props: PageProps<"/finances/vendors/[id]/edit">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <EditVendor params={props.params} />
      </Suspense>
    </div>
  );
}

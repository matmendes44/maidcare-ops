import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { NoAccess } from "../../no-access";
import { createVendor } from "../actions";
import { getNextVendorCode } from "../data";
import { VendorForm } from "../vendor-form";

async function NewVendor() {
  if (!can(await getCurrentUser(), "expenses.manage")) return <NoAccess what="this page" />;
  const vendorCode = await getNextVendorCode();
  return (
    <>
      <Link href="/finances/vendors" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Vendors
      </Link>
      <h1 className="text-3xl font-bold">Add vendor</h1>
      <VendorForm
        mode="create"
        action={createVendor}
        cancelHref="/finances/vendors"
        initialValues={{ vendorCode, name: "", defaultCategory: "", contactName: "", email: "", phone: "", website: "", address: "", accountNumber: "", notes: "", isActive: "true" }}
      />
    </>
  );
}

export default function NewVendorPage() {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <NewVendor />
      </Suspense>
    </div>
  );
}

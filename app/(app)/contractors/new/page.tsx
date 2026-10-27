import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { today } from "@/lib/today";
import { NoAccess } from "../../finances/no-access";
import { createContractor } from "../actions";
import { ContractorForm } from "../contractor-form";

async function NewContractor() {
  const user = await getCurrentUser();
  if (!can(user, "contractors.manage")) return <NoAccess what="this page" />;
  const day = await today();
  return (
    <>
      <Link href="/contractors" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Contractors
      </Link>
      <h1 className="text-3xl font-bold">Add contractor</h1>
      <p className="mt-1 text-sm text-muted-foreground">They also get a vendor ID: what you pay them is recorded as expenses to it (Contract labor).</p>
      <ContractorForm
        mode="create"
        action={createContractor}
        cancelHref="/contractors"
        withTax={can(user, "contractors.tax")}
        tinOnFile={null}
        initialValues={{ firstName: "", lastName: "", businessName: "", email: "", phone: "", street: "", city: "", state: "", zip: "", taxClassification: "individual", w9ReceivedOn: "", startDate: day, isActive: "true", notes: "", tinType: "ssn", tin: "", dayRate: "" }}
      />
    </>
  );
}

export default function NewContractorPage() {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <NewContractor />
      </Suspense>
    </div>
  );
}

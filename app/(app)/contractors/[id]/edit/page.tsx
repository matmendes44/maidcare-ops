import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { maskTin } from "@/lib/contractors/tax";
import { NoAccess } from "../../../finances/no-access";
import { updateContractor } from "../../actions";
import { ContractorForm } from "../../contractor-form";
import { getContractor, parseContractorId } from "../../data";

async function EditContractor({ params }: Pick<PageProps<"/contractors/[id]/edit">, "params">) {
  const user = await getCurrentUser();
  if (!can(user, "contractors.manage")) return <NoAccess what="this page" />;
  const id = parseContractorId((await params).id);
  const c = id === null ? null : await getContractor(id);
  if (!c) notFound();
  return (
    <>
      <Link href={`/contractors/${c.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {c.firstName} {c.lastName}
      </Link>
      <h1 className="text-3xl font-bold">Edit contractor</h1>
      <ContractorForm
        mode="edit"
        action={updateContractor.bind(null, c.id)}
        cancelHref={`/contractors/${c.id}`}
        withTax={can(user, "contractors.tax")}
        tinOnFile={maskTin(c.tinType, c.tinLast4)}
        initialValues={{
          firstName: c.firstName,
          lastName: c.lastName,
          businessName: c.businessName ?? "",
          email: c.email ?? "",
          phone: c.phone ?? "",
          street: c.street ?? "",
          city: c.city ?? "",
          state: c.state ?? "",
          zip: c.zip ?? "",
          taxClassification: c.taxClassification ?? "",
          w9ReceivedOn: c.w9ReceivedOn ?? "",
          startDate: c.startDate ?? "",
          isActive: String(c.isActive),
          notes: c.notes ?? "",
          tinType: c.tinType ?? "ssn",
          tin: "",
          dayRate: "",
        }}
      />
    </>
  );
}

export default function EditContractorPage(props: PageProps<"/contractors/[id]/edit">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <EditContractor params={props.params} />
      </Suspense>
    </div>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { getI18n } from "@/lib/i18n/server";
import { getCustomerOptions } from "../../customers/data";
import { createProperty } from "../actions";
import { PropertyForm } from "../property-form";

async function NewPropertyForm({ searchParams }: Pick<PageProps<"/properties/new">, "searchParams">) {
  const raw = (await searchParams).customer;
  const customerId = typeof raw === "string" && /^\d+$/.test(raw) ? raw : "";
  const [customers, { t }] = await Promise.all([getCustomerOptions(), getI18n()]);
  // came from a customer's page: go back there on cancel
  const cancelHref = customerId ? `/customers/${customerId}` : "/properties";

  return (
    <>
      <Link
        href={cancelHref}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {customerId ? t.properties.backToCustomer : t.properties.title}
      </Link>
      <h1 className="text-3xl font-bold">{t.properties.addTitle}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t.common.requiredHint}</p>
      <PropertyForm
        mode="create"
        action={createProperty}
        customers={customers}
        initialValues={{ customerId }}
        cancelHref={cancelHref}
      />
    </>
  );
}

export default function NewPropertyPage(props: PageProps<"/properties/new">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <NewPropertyForm searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

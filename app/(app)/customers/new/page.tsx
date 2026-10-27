import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { createCustomer, createLead } from "../actions";
import { CustomerForm } from "../customer-form";
import { LeadForm } from "../lead-form";
import { getNextCustomerCode, getReferrerOptions } from "../data";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

function Back({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

async function NewCustomerForm({ lead }: { lead: boolean }) {
  // anyone can add a lead; adding a customer directly needs permission
  if (!lead && !can(await getCurrentUser(), "customers.create")) notFound();
  const [suggestedCode, referrers, startDate, { t, tr }] = await Promise.all([getNextCustomerCode(), getReferrerOptions(), today(), getI18n()]);
  if (lead)
    return (
      <>
        <Back href="/leads" label={tr("Leads")} />
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-3xl font-bold">
          {tr("Create New Lead")}
          <span className="font-mono text-2xl font-medium text-muted-foreground/70" title={tr("The next available customer number, given when the lead is saved")}>
            {suggestedCode}
          </span>
        </h1>
        <LeadForm action={createLead} />
      </>
    );
  return (
    <>
      <Back href="/customers" label={t.customers.title} />
      <h1 className="text-3xl font-bold">{t.customers.form.addTitle}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t.customers.form.addIntro}</p>
      <CustomerForm
        mode="create"
        action={createCustomer}
        referrers={referrers}
        cancelHref="/customers"
        canEditStripe={can(await getCurrentUser(), "stripe.manage")}
        initialValues={{
          customerCode: suggestedCode,
          type: "residential",
          status: "active",
          startDate,
          endDate: "",
          endReasons: "",
          firstName: "",
          lastName: "",
          companyName: "",
          email: "",
          referredById: "",
          billingPropertyId: "",
          stripeCustomerId: "",
          notes: "",
        }}
      />
    </>
  );
}

// ?lead=1 (from the Leads page) starts the form as a lead.
async function NewCustomer({ searchParams }: Pick<PageProps<"/customers/new">, "searchParams">) {
  return <NewCustomerForm lead={(await searchParams).lead === "1"} />;
}

export default function NewCustomerPage(props: PageProps<"/customers/new">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <NewCustomer searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

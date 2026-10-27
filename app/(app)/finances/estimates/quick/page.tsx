import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Tags } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { company } from "@/lib/company";
import { getI18n } from "@/lib/i18n/server";
import { NoAccess } from "../../no-access";
import { createQuickQuote } from "../actions";
import { getPriceList, nextQuoteNumber, quoteParties } from "../data";
import { QuickForm } from "./quick-form";

// ?customer=ID starts it for that customer or lead.
async function Quick({ searchParams }: Pick<PageProps<"/finances/estimates/quick">, "searchParams">) {
  const user = await getCurrentUser();
  if (!can(user, "quotes.manage")) return <NoAccess what="this page" />;
  const [sp, list, parties, number, { tr }] = await Promise.all([searchParams, getPriceList(), quoteParties(), nextQuoteNumber(), getI18n()]);
  return (
    <>
      <Link href="/finances/estimates" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {tr("Estimates")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{tr("New estimate")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tr("Fill in the home and what to offer: prices come from your price list.")}</p>
        </div>
        {can(user, "priceList.manage") && (
        <Link href="/finances/estimates/pricing" className={buttonVariants({ variant: "outline" })}>
          <Tags aria-hidden="true" />
          {tr("Price list")}
        </Link>
        )}
      </div>
      <QuickForm
        action={createQuickQuote}
        list={list}
        customers={parties.customers}
        properties={parties.properties}
        company={company}
        number={number}
        initialCustomer={typeof sp.customer === "string" ? sp.customer : ""}
      />
    </>
  );
}

export default function QuickPage(props: PageProps<"/finances/estimates/quick">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Quick searchParams={props.searchParams} />
    </Suspense>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { company } from "@/lib/company";
import { NoAccess } from "../../../no-access";
import { updateQuote } from "../../actions";
import { getQuote, parseId, quoteParties } from "../../data";
import { QuoteForm } from "../../quote-form";
import { getI18n } from "@/lib/i18n/server";

async function EditQuote({ params }: Pick<PageProps<"/finances/estimates/[id]/edit">, "params">) {
  if (!can(await getCurrentUser(), "quotes.manage")) return <NoAccess what="this page" />;
  const id = parseId((await params).id);
  const q = id === null ? null : await getQuote(id);
  if (!q) notFound();
  const { tr } = await getI18n();
  if (q.status === "accepted")
    return (
      <p className="rounded-lg border px-4 py-8 text-center">
        {tr("Accepted estimates can't be changed.")}{" "}
        <Link href={`/finances/estimates/${q.id}`} className="text-link hover:underline">
          {tr("Back to it")}
        </Link>
      </p>
    );
  const parties = await quoteParties();
  return (
    <>
      <Link href={`/finances/estimates/${q.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {tr("Estimate #{n}", { n: q.quoteNumber })}
      </Link>
      <h1 className="text-3xl font-bold">{tr("Edit estimate #{n}", { n: q.quoteNumber })}</h1>
      <QuoteForm
        mode="edit"
        action={updateQuote.bind(null, q.id)}
        customers={parties.customers}
        properties={parties.properties}
        company={company}
        number={q.quoteNumber}
        cancelHref={`/finances/estimates/${q.id}`}
        initial={{ customerId: String(q.customerId), propertyId: q.propertyId ? String(q.propertyId) : "", internalNotes: q.internalNotes ?? "", content: q.content }}
      />
    </>
  );
}

export default function EditQuotePage(props: PageProps<"/finances/estimates/[id]/edit">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EditQuote params={props.params} />
    </Suspense>
  );
}

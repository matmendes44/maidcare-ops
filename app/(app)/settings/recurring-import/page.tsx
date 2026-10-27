import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { importCandidates } from "@/lib/recurring/import";
import { frequencyLabel } from "@/lib/recurring/schedule";
import { today } from "@/lib/today";
import { ImportForm } from "./import-form";

// Owner only: turn service plans into memorized (recurring) invoices, from
// each customer's latest real invoice. A review first; nothing in Stripe.
async function RecurringImport({ searchParams }: Pick<PageProps<"/settings/recurring-import">, "searchParams">) {
  if (!can(await getCurrentUser(), "invoices.memorize")) notFound();
  const [sp, day] = await Promise.all([searchParams, today()]);
  const rows = await importCandidates(day);
  const created = typeof sp.created === "string" ? Number(sp.created) : null;
  return (
    <>
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>
      <h1 className="text-2xl font-bold sm:text-3xl">Recurring invoices from service plans</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Each open service plan becomes the customer&apos;s recurring invoice for that property: the lines of their latest finalized invoice, repeating as often as the plan
        says. Customers without a finalized invoice in the last 7 weeks are left out as not recurring. Nothing is created in Stripe, and running this again skips anyone who
        already has a recurring invoice.
      </p>
      {created !== null && (
        <p role="status" className="mt-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {created} recurring invoice{created === 1 ? "" : "s"} created.
        </p>
      )}
      <div className="mt-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open service plans.</p>
        ) : (
          <ImportForm rows={rows.map((r) => ({ ...r, frequencyLabel: r.frequency ? frequencyLabel[r.frequency] : null, invoice: r.invoice && { id: r.invoice.id, number: r.invoice.number, status: r.invoice.status, day: r.invoice.day, totalCents: r.invoice.totalCents } }))} />
        )}
      </div>
    </>
  );
}

export default function RecurringImportPage(props: PageProps<"/settings/recurring-import">) {
  return (
    <div className="max-w-4xl">
      <Suspense fallback={<PageLoading />}>
        <RecurringImport searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

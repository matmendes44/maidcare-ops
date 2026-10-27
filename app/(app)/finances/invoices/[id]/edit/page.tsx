import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { today as getToday } from "@/lib/today";
import { getInvoiceDetail, getInvoiceFormOptions, parseInvoiceId, serviceDateOf } from "../../../data";
import { updateInvoice } from "../../actions";
import { InvoiceForm } from "../../invoice-form";

// Stripe due dates are unix seconds; the form wants the Eastern calendar date.
const easternDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));

async function EditInvoiceForm({ params }: Pick<PageProps<"/finances/invoices/[id]/edit">, "params">) {
  if (!can(await getCurrentUser(), "invoices.create")) notFound();
  const id = parseInvoiceId((await params).id);
  const [detail, options, today] = await Promise.all([id === null ? null : getInvoiceDetail(id), getInvoiceFormOptions(), getToday()]);
  if (!detail) notFound();
  const { invoice: inv, stripeInvoice, lines } = detail;
  // only drafts can change; anything else goes back to the invoice
  if (inv.status !== "draft" || !inv.customerId) redirect(`/finances/invoices/${inv.id}`);

  return (
    <>
      <Link href={`/finances/invoices/${inv.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to invoice
      </Link>
      <h1 className="text-3xl font-bold">Edit draft invoice</h1>
      <InvoiceForm
        mode="edit"
        action={updateInvoice.bind(null, inv.id)}
        options={options}
        today={today}
        cancelHref={`/finances/invoices/${inv.id}`}
        initialValues={{
          customerId: String(inv.customerId),
          propertyId: inv.propertyId ? String(inv.propertyId) : "",
          // keep a past due date editable rather than blanking it
          dueDate: inv.dueDate ? easternDate(inv.dueDate) : today,
          memo: stripeInvoice.description ?? "",
          lines: lines.map((l) => {
            const qty = l.quantity || 1;
            return {
              description: l.description ?? "",
              serviceDate: serviceDateOf(l, stripeInvoice.created) ?? "",
              quantity: String(qty),
              price: (l.amount / qty / 100).toFixed(2),
            };
          }),
        }}
      />
    </>
  );
}

export default function EditInvoicePage(props: PageProps<"/finances/invoices/[id]/edit">) {
  return (
    <div className="max-w-4xl">
      <Suspense fallback={<PageLoading />}>
        <EditInvoiceForm params={props.params} />
      </Suspense>
    </div>
  );
}

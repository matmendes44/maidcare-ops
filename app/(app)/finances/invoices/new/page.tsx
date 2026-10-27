import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, memorizedInvoices } from "@/db/schema";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { TIME_ZONE } from "@/lib/i18n/config";
import { today as getToday } from "@/lib/today";
import { getInvoiceFormOptions } from "../../data";
import { createInvoice } from "../actions";
import { InvoiceForm } from "../invoice-form";

// Prefill from a visit (?appointment=ID, from the Fleet or appointment page):
// its customer, property and date, and the price it's already invoiced at or
// else the customer's recurring invoice.
async function appointmentPrefill(raw: string | undefined) {
  if (!raw || !/^\d+$/.test(raw)) return null;
  await requireUser();
  const a = await db.query.appointments.findFirst({ where: eq(appointments.id, Number(raw)) });
  if (!a) return null;
  // what it's invoiced at already, else the customer's recurring invoice
  const [memorized] = a.priceCents
    ? []
    : await db
        .select({ totalCents: memorizedInvoices.totalCents, lines: memorizedInvoices.lines })
        .from(memorizedInvoices)
        .where(and(eq(memorizedInvoices.customerId, a.customerId), eq(memorizedInvoices.isActive, true), sql`coalesce(${memorizedInvoices.propertyId}, ${a.propertyId}) = ${a.propertyId}`));
  const cents = a.priceCents || memorized?.totalCents || 0;
  const description = (memorized?.lines as { description: string }[] | undefined)?.[0]?.description ?? "Cleaning service";
  return {
    id: a.id,
    customerId: String(a.customerId),
    propertyId: String(a.propertyId),
    line: {
      description,
      serviceDate: new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(a.scheduledStart)),
      quantity: "1",
      price: cents ? (cents / 100).toFixed(2) : "",
    },
  };
}

async function NewInvoiceForm({ searchParams }: Pick<PageProps<"/finances/invoices/new">, "searchParams">) {
  if (!can(await getCurrentUser(), "invoices.create")) notFound();
  const [params, options, today] = await Promise.all([searchParams, getInvoiceFormOptions(), getToday()]);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const visit = await appointmentPrefill(one(params.appointment));
  const raw = visit?.customerId ?? one(params.customer);
  const customerId = raw && /^\d+$/.test(raw) ? raw : "";
  const theirs = options.properties.filter((p) => String(p.customerId) === customerId);
  const property = theirs.find((p) => String(p.id) === visit?.propertyId) ?? theirs.find((p) => p.isBilling) ?? theirs[0];
  const back = visit ? `/appointments/${visit.id}` : customerId ? `/customers/${customerId}` : "/finances";

  return (
    <>
      <Link href={back} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {visit ? "Back to appointment" : customerId ? "Back to customer" : "Finances"}
      </Link>
      <h1 className="text-3xl font-bold">New invoice</h1>
      <p className="mt-1 text-sm text-muted-foreground">Fields marked * are required.</p>
      <InvoiceForm
        mode="create"
        action={createInvoice}
        options={options}
        today={today}
        cancelHref={back}
        initialValues={{
          customerId,
          propertyId: property ? String(property.id) : "",
          dueDate: today,
          memo: "",
          lines: visit ? [visit.line] : [],
        }}
        appointmentId={visit?.id}
      />
    </>
  );
}

export default function NewInvoicePage(props: PageProps<"/finances/invoices/new">) {
  return (
    <div className="max-w-4xl">
      <Suspense fallback={<PageLoading />}>
        <NewInvoiceForm searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

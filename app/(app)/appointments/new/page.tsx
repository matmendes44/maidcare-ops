import { randomUUID } from "node:crypto";
import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";
import { createAppointment } from "../actions";
import { AppointmentForm } from "../appointment-form";
import { getBookingOptions } from "../data";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function NewAppointmentForm({ searchParams }: Pick<PageProps<"/appointments/new">, "searchParams">) {
  const params = await searchParams;
  const [options, todayDate, { t }, user] = await Promise.all([getBookingOptions(), today(), getI18n(), getCurrentUser()]);
  // ?customer=…&property=…&date=… prefill from links on other pages
  const customerId = /^\d+$/.test(one(params.customer)) ? one(params.customer) : "";
  const theirs = options.properties.filter((p) => String(p.customerId) === customerId);
  const property =
    theirs.find((p) => String(p.id) === one(params.property)) ?? theirs.find((p) => p.isBilling) ?? theirs[0];
  // a day picked on the calendar (else they pick one on the form)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one(params.date)) ? one(params.date) : "";
  const activeVehicles = options.vehicles.filter((v) => v.isActive);
  const cancelHref = customerId ? `/customers/${customerId}` : "/appointments";
  // booked from an accepted estimate: its first-visit invoice, once it's open
  const quoteId = /^\d{1,15}$/.test(one(params.quote)) ? Number(one(params.quote)) : null;
  const [quote] = quoteId ? await db.select({ invoiceId: quotes.invoiceId }).from(quotes).where(eq(quotes.id, quoteId)) : [];
  const quoteInvoice = quote?.invoiceId && options.invoices.some((i) => i.id === quote.invoiceId && String(i.customerId) === customerId) ? String(quote.invoiceId) : "";

  return (
    <>
      <Link
        href={cancelHref}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {customerId ? t.appointments.form.backToCustomer : t.appointments.title}
      </Link>
      <h1 className="text-3xl font-bold">{t.appointments.form.newTitle}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t.appointments.form.timesEastern}</p>
      <AppointmentForm
        quoteId={quoteId}
        mode="create"
        action={createAppointment}
        options={options}
        cancelHref={cancelHref}
        today={todayDate}
        canMakeInvoice={can(user, "invoices.create")}
        exactTimes={user?.role === "owner"}
        // a fresh key per form: its draft invoice (if billed to the recurring one) is made once
        token={randomUUID()}
        initialValues={{
          customerId,
          propertyId: property ? String(property.id) : "",
          // from Invoice & book (a recurring visit's draft), else an accepted estimate's
          invoiceId: options.invoices.some((i) => String(i.id) === one(params.invoice) && String(i.customerId) === customerId) ? one(params.invoice) : quoteInvoice,
          // the only vehicle is the obvious choice
          vehicleIds: activeVehicles.length === 1 ? [String(activeVehicles[0].id)] : [],
          contractorIds: [],
          date,
          start: /^([01]\d|2[0-3]):[0-5]\d$/.test(one(params.start)) ? one(params.start) : "09:00",
          end: /^([01]\d|2[0-3]):[0-5]\d$/.test(one(params.end)) ? one(params.end) : "11:00",
          status: "pending",
          notes: "",
        }}
      />
    </>
  );
}

export default function NewAppointmentPage(props: PageProps<"/appointments/new">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <NewAppointmentForm searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

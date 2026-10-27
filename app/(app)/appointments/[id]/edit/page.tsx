import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { updateAppointment } from "../../actions";
import { AppointmentForm } from "../../appointment-form";
import { getAppointment, getBookingOptions, parseAppointmentId } from "../../data";
import { PageLoading } from "@/components/page-loading";
import { getI18n } from "@/lib/i18n/server";
import { toLocalInputs } from "../../options";
import { today } from "@/lib/today";
import { canChangeAppointment } from "@/lib/appointments/access";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

async function EditAppointmentForm({ params }: Pick<PageProps<"/appointments/[id]/edit">, "params">) {
  const id = parseAppointmentId((await params).id);
  const [row, options] = id === null ? [null, null] : await Promise.all([getAppointment(id), getBookingOptions()]);
  if (!row || !options) notFound();
  const [{ t, fmt }, todayDate, user] = await Promise.all([getI18n(), today(), getCurrentUser()]);
  const a = row.appointment;
  // past visits are view-only without appointments.editPast
  if (!canChangeAppointment(user, a.scheduledStart, todayDate)) notFound();
  // its unpaid invoice can be swapped for another of the customer's; it's one of the choices
  const current = row.invoices.find((i) => i.status === "draft" || i.status === "open");
  const choices = current && !options.invoices.some((i) => i.id === current.id)
    ? [{ id: current.id, customerId: a.customerId, number: current.number ?? "Draft", isDraft: current.status === "draft", totalCents: current.totalCents, dueDate: null, description: null }, ...options.invoices]
    : options.invoices;
  const start = toLocalInputs(a.scheduledStart);
  const end = toLocalInputs(a.scheduledEnd);

  return (
    <>
      <Link
        href={`/appointments/${a.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t.appointments.form.backToAppointment}
      </Link>
      <h1 className="text-3xl font-bold">{t.appointments.form.editTitle}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {fmt.day(a.scheduledStart)} · {fmt.timeRange(a.scheduledStart, a.scheduledEnd)}. {t.appointments.form.timesEastern}
      </p>
      <AppointmentForm
        mode="edit"
        action={updateAppointment.bind(null, a.id)}
        options={{ ...options, invoices: choices }}
        canSetStatus={can(user, "appointments.complete")}
        exactTimes={user?.role === "owner"}
        cancelHref={`/appointments/${a.id}`}
        today={todayDate}
        initialValues={{
          customerId: String(a.customerId),
          propertyId: String(a.propertyId),
          invoiceId: current ? String(current.id) : "",
          vehicleIds: row.vehicles.map((v) => String(v.id)),
          contractorIds: row.contractors.map((c) => String(c.id)),
          date: start.date,
          start: start.time,
          end: end.time,
          status: a.status,
          notes: a.notes ?? "",
        }}
      />
    </>
  );
}

export default function EditAppointmentPage(props: PageProps<"/appointments/[id]/edit">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <EditAppointmentForm params={props.params} />
      </Suspense>
    </div>
  );
}

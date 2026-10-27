import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AlertTriangle, CalendarDays, List, Pencil } from "lucide-react";
import { isMissed } from "@/lib/appointments/missed";
import { canChangeAppointment } from "@/lib/appointments/access";
import { today } from "@/lib/today";
import { RecordTabs } from "@/components/record-tabs";
import {
  Empty,
  Field,
  FieldColumn,
  FieldGroup,
  RecordType,
  linkClass,
} from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { displayName } from "../../customers/options";
import { formatAddress } from "../../properties/options";
import { getAppointment, getAppointmentHistory, parseAppointmentId } from "../data";
import { PageLoading } from "@/components/page-loading";
import type { Formatters } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import { getI18n } from "@/lib/i18n/server";
import { statusVariant, toLocalInputs, type AppointmentStatus } from "../options";
import { DeleteAppointmentButton } from "./delete-button";
import { StatusButtons } from "./status-buttons";

// How an audited value reads in the history.
function HistoryValue({
  field,
  value,
  names,
  t,
  fmt,
}: {
  field: string;
  value: unknown;
  names: Record<string, Record<number, string>>;
  t: Messages;
  fmt: Formatters;
}) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">{t.common.empty}</span>;
  if (field === "status") return <>{t.enums.appointmentStatus[value as AppointmentStatus] ?? String(value)}</>;
  if (field === "price_cents" && typeof value === "number") return <>{fmt.money(value)}</>;
  if (field.startsWith("scheduled_") || field.startsWith("actual_a") || field.startsWith("actual_d"))
    return <>{fmt.stamp(String(value))}</>;
  if (field in names && typeof value === "number") return <>{names[field][value] ?? `#${value}`}</>;
  return <>{String(value)}</>;
}

async function AppointmentRecord({
  params,
  searchParams,
}: Pick<PageProps<"/appointments/[id]">, "params" | "searchParams">) {
  const id = parseAppointmentId((await params).id);
  const [row, history] =
    id === null ? [null, null] : await Promise.all([getAppointment(id), getAppointmentHistory(id)]);
  if (!row || !history) notFound();
  const [{ saved }, { t, fmt, tr }, user] = await Promise.all([searchParams, getI18n(), getCurrentUser()]);
  const invoiceStatus = (status: string) => {
    const label = `invoice|${status.charAt(0).toUpperCase()}${status.slice(1)}`;
    return tr(label).toLowerCase();
  };
  const canSeeContractors = can(user, "contractors.view");
  // past visits are view-only without appointments.editPast
  const changeable = canChangeAppointment(user, row.appointment.scheduledStart, await today());
  const savedMessages: Record<string, string> = t.appointments.saved;
  const d = t.appointments.detail;
  const a = row.appointment;
  const savedKey = typeof saved === "string" ? saved : "";
  const weekHref = `/appointments?view=week&date=${toLocalInputs(a.scheduledStart).date}`;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <RecordType icon={CalendarDays}>{t.appointments.record}</RecordType>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xl font-bold">
            <span>
              {fmt.day(a.scheduledStart)}
              <span className="text-muted-foreground"> · {fmt.timeRange(a.scheduledStart, a.scheduledEnd)}</span>
            </span>
            <Badge variant={statusVariant[a.status]} className="h-7 px-3 text-[0.8rem]">
              {t.enums.appointmentStatus[a.status]}
            </Badge>
          </h1>
          <p className="mt-1 text-[0.95rem] text-muted-foreground">
            <Link href={`/customers/${row.customer.id}`} className={linkClass}>
              {row.customer.customerCode} {displayName(row.customer)}
            </Link>{" "}
            · {formatAddress(row.property)}
          </p>
        </div>
        <Link href={weekHref} className={buttonVariants({ variant: "ghost", className: "text-muted-foreground" })}>
          <List aria-hidden="true" />
          {t.appointments.weekLink}
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-b pb-4">
        {changeable && (
          <Link href={`/appointments/${a.id}/edit`} className={buttonVariants()}>
            <Pencil aria-hidden="true" />
            {t.common.edit}
          </Link>
        )}
        <Link href={weekHref} className={buttonVariants({ variant: "outline" })}>
          {t.common.back}
        </Link>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <StatusButtons key={a.status} id={a.id} status={a.status} canComplete={can(user, "appointments.complete")} canCancel={changeable} />
        {can(user, "appointments.delete") && (
          <>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
            <DeleteAppointmentButton
              id={a.id}
              summary={t.appointments.remove.summary(
                displayName(row.customer),
                fmt.day(a.scheduledStart),
                fmt.timeRange(a.scheduledStart, a.scheduledEnd),
              )}
            />
          </>
        )}
      </div>

      {isMissed(a) && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong>{tr("Missed:")}</strong> {tr("this visit's time has passed and nobody arrived. Reschedule it, or mark it completed if it was done.")}
          </span>
          {changeable ? (
            <Link href={`/appointments/${a.id}/edit`} className={buttonVariants({ size: "sm" })}>
              {tr("Reschedule")}
            </Link>
          ) : (
            <Link href={`/appointments/new?customer=${row.customer.id}&property=${row.property.id}`} className={buttonVariants({ size: "sm" })}>
              {tr("Book a new visit")}
            </Link>
          )}
        </div>
      )}
      {savedMessages[savedKey] && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground"
        >
          {savedMessages[savedKey]}
        </p>
      )}

      <div className="mt-6">
        <FieldGroup title={t.record.primaryInfo}>
          <FieldColumn>
            <Field label={d.customer}>
              <Link href={`/customers/${row.customer.id}`} className={linkClass}>
                {row.customer.customerCode} {displayName(row.customer)}
              </Link>
            </Field>
            <Field label={d.status}>{t.enums.appointmentStatus[a.status]}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={d.property}>
              {can(user, "properties.edit") ? (
                <Link href={`/properties/${row.property.id}/edit`} className={linkClass}>
                  {row.property.street}
                  {row.property.unit && `, ${row.property.unit}`}
                </Link>
              ) : (
                <>
                  {row.property.street}
                  {row.property.unit && `, ${row.property.unit}`}
                </>
              )}
              <br />
              {row.property.city}, {row.property.state} {row.property.zip}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={d.accessNotes}>
              {row.property.accessNotes && <span className="whitespace-pre-wrap">{row.property.accessNotes}</span>}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={d.notes}>{a.notes && <span className="whitespace-pre-wrap">{a.notes}</span>}</Field>
          </FieldColumn>
        </FieldGroup>

        <FieldGroup title={d.schedule}>
          <FieldColumn>
            <Field label={d.date}>{fmt.day(a.scheduledStart)}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={d.time}>
              {fmt.timeRange(a.scheduledStart, a.scheduledEnd)}
              {/* GPS moved today's times to when the crew really arrived and left */}
              {a.bookedStart && a.bookedEnd && (a.bookedStart !== a.scheduledStart || a.bookedEnd !== a.scheduledEnd) && (
                <span className="block text-[0.8rem] text-muted-foreground">{tr("Updated from GPS · booked {time}", { time: fmt.timeRange(a.bookedStart, a.bookedEnd) })}</span>
              )}
            </Field>
            <Field label={d.duration}>{fmt.duration(a.scheduledStart, a.scheduledEnd)}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={row.vehicles.length > 1 ? tr("Vehicles") : d.vehicle}>
              {row.vehicles.length > 0 && (
                <span className="grid gap-0.5">
                  {row.vehicles.map((v) => (
                    <span key={v.id}>
                      {v.name}
                      {v.plate && <span className="text-muted-foreground"> · {v.plate}</span>}
                    </span>
                  ))}
                </span>
              )}
            </Field>
            <Field label={tr("Contractors")}>
              {row.contractors.length > 0 &&
                row.contractors.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    {canSeeContractors ? (
                      <Link href={`/contractors/${c.id}`} className={linkClass}>
                        {c.firstName} {c.lastName}
                      </Link>
                    ) : (
                      `${c.firstName} ${c.lastName}`
                    )}
                  </span>
                ))}
            </Field>
          </FieldColumn>
          <FieldColumn>
            {a.actualArrival && a.actualDeparture && (
              <Field label={d.actual}>
                {fmt.timeRange(a.actualArrival, a.actualDeparture)}
                <span className="text-muted-foreground"> · {fmt.duration(a.actualArrival, a.actualDeparture)}</span>
              </Field>
            )}
            {a.actualArrival && !a.actualDeparture && (
              <Field label={tr("Arrived")}>
                {fmt.time(a.actualArrival)}
                <span className="text-muted-foreground"> · {tr("still there")}</span>
              </Field>
            )}
          </FieldColumn>
        </FieldGroup>

        <FieldGroup title={d.billing}>
          <FieldColumn>
            <Field label={d.price}>
              {/* what it's invoiced for */}
              {row.invoices.some((i) => i.status !== "void") ? (
                <span className="font-semibold tabular-nums">{fmt.money(a.priceCents)}</span>
              ) : (
                <span className="text-muted-foreground">{tr("Not invoiced yet")}</span>
              )}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={d.paid}>{row.paidCents > 0 && fmt.money(row.paidCents)}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={row.invoices.length > 1 ? tr("Invoices") : d.invoice}>
              {row.invoices.length > 0 ? (
                <span className="grid gap-0.5">
                  {row.invoices.map((i) => (
                    <Link key={i.id} href={`/finances/invoices/${i.id}`} className={cn("text-link hover:underline", i.status === "void" && "line-through opacity-60")}>
                      {i.number ?? tr("invoice|Draft")} · {fmt.money(i.totalCents)}
                      <span className="text-muted-foreground"> ({invoiceStatus(i.status)})</span>
                    </Link>
                  ))}
                </span>
              ) : can(user, "invoices.create") ? (
                <Link href={`/finances/invoices/new?appointment=${a.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {tr("Make invoice")}
                </Link>
              ) : (
                <span className="text-muted-foreground">{tr("None yet")}</span>
              )}
            </Field>
          </FieldColumn>
        </FieldGroup>
      </div>

      <RecordTabs
        key={`${a.id}:${history.entries.length}`}
        defaultTab="history"
        tabs={[
          {
            value: "history",
            label: t.appointments.history.tab,
            count: history.entries.length,
            content:
              history.entries.length === 0 ? (
                <Empty>{t.appointments.history.empty}</Empty>
              ) : (
                <ol className="grid gap-4">
                  {history.entries.map((e) => {
                    const changes = e.changes as Record<string, { from: unknown; to: unknown }>;
                    return (
                      <li key={e.id} className="grid gap-1 border-l-2 border-brand-blue/30 pl-4">
                        <p className="text-sm">
                          <span className="font-semibold">
                            {e.action === "insert"
                              ? t.appointments.history.created
                              : e.action === "delete"
                                ? t.appointments.history.deleted
                                : t.appointments.history.changed}
                          </span>{" "}
                          {t.appointments.history.by}{" "}
                          {e.userName ?? <span className="italic">{t.common.system}</span>}
                          <span className="text-muted-foreground"> · {fmt.stamp(e.changedAt)}</span>
                        </p>
                        {e.action === "update" && (
                          <ul className="grid gap-0.5 text-sm">
                            {Object.entries(changes).map(([field, { from, to }]) => (
                              <li key={field}>
                                <span className="text-muted-foreground">
                                  {(t.appointments.history.fields as Record<string, string>)[field] ?? field}:
                                </span>{" "}
                                <span className="line-through decoration-muted-foreground/60">
                                  <HistoryValue field={field} value={from} names={history.names} t={t} fmt={fmt} />
                                </span>{" "}
                                → <HistoryValue field={field} value={to} names={history.names} t={t} fmt={fmt} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ),
          },
          {
            value: "system",
            label: t.record.systemInfo,
            content: (
              <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t.appointments.system.created}>
                  {a.createdAt ? (
                    fmt.stamp(a.createdAt)
                  ) : (
                    <span className="text-muted-foreground">{t.appointments.system.beforeTracking}</span>
                  )}
                </Field>
                <Field label={t.appointments.system.createdBy}>{row.createdByName}</Field>
                <Field label={t.appointments.system.lastModified}>{a.updatedAt && fmt.stamp(a.updatedAt)}</Field>
                <Field label={t.appointments.system.lastModifiedBy}>
                  {a.updatedAt && (row.updatedByName ?? <span className="italic">{t.common.system}</span>)}
                </Field>
                <Field label={t.record.internalId}>
                  <span className="font-mono">{a.id}</span>
                </Field>
                <Field label={t.appointments.system.gcal}>
                  {a.gcalEventId && <span className="font-mono text-[0.8rem]">{a.gcalEventId}</span>}
                </Field>
              </dl>
            ),
          },
        ]}
      />
    </>
  );
}

export default function AppointmentPage(props: PageProps<"/appointments/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AppointmentRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

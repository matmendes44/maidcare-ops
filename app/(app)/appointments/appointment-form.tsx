"use client";

import Link from "next/link";
import { Repeat } from "lucide-react";
import { startTransition, useActionState, useRef, useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ChoiceTile } from "@/components/choice-tile";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { CustomerPicker, type CustomerOption } from "../properties/customer-picker";
import { dayAgenda, type AppointmentField, type AppointmentFormState } from "./actions";
import { BookingCalendar } from "./booking-calendar";
import { CrewPicker } from "./crew-picker";
import { DayView, type DayItem } from "./day-view";
import { appointmentStatuses } from "./options";
import { frequencyLabel, type Frequency } from "@/lib/recurring/schedule";

export type BookingOptions = {
  customers: CustomerOption[];
  properties: { id: number; customerId: number; label: string; isBilling: boolean }[];
  vehicles: { id: number; label: string; isActive: boolean }[];
  contractors: { id: number; label: string; isActive: boolean }[];
  // customers' recurring (memorized) invoices: the default bill for a booking
  recurring: { id: number; customerId: number; propertyId: number | null; frequency: Frequency; totalCents: number }[];
  // open invoices not billing an active visit (bookings need one)
  invoices: { id: number; customerId: number; number: string; isDraft: boolean; totalCents: number; dueDate: string | null; description: string | null }[];
};

export type AppointmentFormValues = {
  customerId: string;
  propertyId: string;
  invoiceId: string;
  vehicleIds: string[];
  contractorIds: string[];
  date: string;
  start: string;
  end: string;
  status: string;
  notes: string;
};


function Field({ id, label, error, children, className }: { id?: string; label: string; error?: string; children: React.ReactNode; className?: string }) {
  const { tr } = useI18n();
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      {id ? <Label htmlFor={id}>{label}</Label> : <p className="text-sm font-medium">{label}</p>}
      {children}
      {error && <p className="text-[0.8rem] text-destructive">{tr(error)}</p>}
    </div>
  );
}

// Booking (and editing) an appointment: who it's for, who's cleaning, when
// (a month calendar, then the times), which vehicles and any notes. A booking
// needs one of the customer's open invoices: that's what prices the visit.
// New ones are always pending. Missing values get a red outline; booking
// shows a summary and that day's schedule to confirm first.
export function AppointmentForm({
  mode,
  action,
  options,
  initialValues,
  cancelHref,
  quoteId,
  today,
  token,
  canSetStatus = true,
  canMakeInvoice = true,
  exactTimes = false,
}: {
  mode: "create" | "edit";
  action: (prev: AppointmentFormState, formData: FormData) => Promise<AppointmentFormState>;
  options: BookingOptions;
  initialValues: AppointmentFormValues;
  cancelHref: string;
  // booked from an accepted estimate (links the visit to it)
  quoteId?: number | null;
  today: string;
  // one per booking form: the key its draft invoice is made with
  token?: string;
  // editing: setting the status (appointments.complete)
  canSetStatus?: boolean;
  // making an invoice by hand (invoices.create)
  canMakeInvoice?: boolean;
  // times to the minute, not just every 15 (the owner)
  exactTimes?: boolean;
}) {
  const { t, tr, fmt } = useI18n();
  const f = t.appointments.form;
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  const [customer, setCustomer] = useState<CustomerOption | null>(options.customers.find((c) => String(c.id) === initialValues.customerId) ?? null);
  const [propertyId, setPropertyId] = useState(initialValues.propertyId);
  const [invoiceId, setInvoiceId] = useState(initialValues.invoiceId);
  // an invoice already chosen (Invoice & book, an estimate) beats the recurring default
  const [billDifferently, setBillDifferently] = useState(Boolean(initialValues.invoiceId));
  const [when, setWhen] = useState({ date: initialValues.date, start: initialValues.start, end: initialValues.end });
  const [crew, setCrew] = useState<string[]>(initialValues.contractorIds);
  const [fleet, setFleet] = useState<string[]>(initialValues.vehicleIds);
  const [notes, setNotes] = useState(initialValues.notes);
  // fields left empty on the last try (red outlines)
  const [missing, setMissing] = useState<Partial<Record<AppointmentField, boolean>>>({});
  const [confirm, setConfirm] = useState<{ data: FormData; day: DayItem[] | null } | null>(null);

  // active contractors and vehicles, plus any already on the appointment
  const contractorOptions = options.contractors.filter((c) => c.isActive || initialValues.contractorIds.includes(String(c.id)));
  const vehicleOptions = options.vehicles.filter((v) => v.isActive || initialValues.vehicleIds.includes(String(v.id)));
  // The chosen customer's properties, plus the appointment's own property on
  // edit (it may since have been transferred to someone else).
  const customerProperties = options.properties.filter((p) => p.customerId === customer?.id || (mode === "edit" && String(p.id) === initialValues.propertyId));

  const serverErrors = state.errors ?? {};
  const bad = (k: AppointmentField) => Boolean(missing[k] || serverErrors[k]);
  const clear = (...k: AppointmentField[]) => setMissing((m) => Object.fromEntries(Object.entries(m).filter(([key]) => !k.includes(key as AppointmentField))));

  function chooseProperty(id: string) {
    setPropertyId(id);
    clear("propertyId");
  }
  function chooseCustomer(next: CustomerOption | null) {
    setCustomer(next);
    setInvoiceId("");
    clear("customerId");
    // default to their billing address, else their first property
    const theirs = options.properties.filter((p) => p.customerId === next?.id);
    const preferred = theirs.find((p) => p.isBilling) ?? theirs[0];
    chooseProperty(preferred ? String(preferred.id) : "");
  }

  function check() {
    const m: Partial<Record<AppointmentField, boolean>> = {};
    if (!customer) m.customerId = true;
    if (!propertyId) m.propertyId = true;
    if (mode === "create" && !useRecurring && !invoiceId) m.invoiceId = true;
    if (crew.length === 0) m.contractorIds = true;
    if (fleet.length === 0) m.vehicleIds = true;
    if (!when.date) m.date = true;
    if (!when.start) m.start = true;
    if (!when.end || when.end <= when.start) m.end = true;
    setMissing(m);
    return Object.keys(m).length === 0;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    const data = new FormData(event.currentTarget);
    if (mode === "edit") {
      startTransition(() => formAction(data));
      return;
    }
    // booking: confirm the summary and the day first
    setConfirm({ data, day: null });
    startTransition(async () => {
      const agenda = await dayAgenda(when.date);
      setConfirm((c) => c && { ...c, day: agenda.map((a) => ({ id: a.id, start: a.start, end: a.end, title: a.customer, sub: a.crew })) });
    });
  }

  const missingCount = Object.keys(missing).length;
  const crewNames = contractorOptions.filter((c) => crew.includes(String(c.id))).map((c) => c.label);
  const vehicleNames = vehicleOptions.filter((v) => fleet.includes(String(v.id))).map((v) => v.label);
  const propertyLabel = customerProperties.find((p) => String(p.id) === propertyId)?.label ?? "";
  const theirInvoices = options.invoices.filter((i) => i.customerId === customer?.id);
  // their recurring invoice for this property (or for any of theirs)
  const theirRecurring = options.recurring.filter((r) => r.customerId === customer?.id);
  const recurring = theirRecurring.find((r) => String(r.propertyId) === propertyId) ?? theirRecurring.find((r) => r.propertyId === null);
  const useRecurring = mode === "create" && Boolean(recurring) && !billDifferently;
  const invoice = theirInvoices.find((i) => String(i.id) === invoiceId);
  const usd = fmt.money;
  // invoices without a number yet come as "Draft"
  const invoiceNo = (number: string) => (number === "Draft" ? tr("invoice|Draft") : number);
  const due = (iso: string | null) => (iso ? tr("due {date}", { date: fmt.monthDay(iso.slice(0, 10)) }) : "");

  return (
    <>
      <form ref={formRef} onSubmit={onSubmit} className="mt-6 grid gap-7" noValidate>
        {quoteId && <input type="hidden" name="quoteId" value={quoteId} />}
        {(state.message || missingCount > 0) && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.message ? tr(state.message) : tr("Fill in the fields outlined in red.")}
          </p>
        )}

        <div className="grid gap-4">
          <Field id="customerId" label={f.customer} error={serverErrors.customerId}>
            <CustomerPicker id="customerId" name="customerId" customers={options.customers} value={customer} onChange={chooseCustomer} invalid={bad("customerId")} />
          </Field>
          <Field id="propertyId" label={f.property} error={serverErrors.propertyId}>
            <NativeSelect id="propertyId" name="propertyId" value={propertyId} onChange={(e) => chooseProperty(e.target.value)} disabled={!customer} aria-invalid={bad("propertyId") || undefined} className="w-full">
              <NativeSelectOption value="" disabled>
                {!customer ? f.chooseCustomerFirst : customerProperties.length === 0 ? f.noProperties : f.chooseProperty}
              </NativeSelectOption>
              {customerProperties.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.label}
                  {p.isBilling ? f.billingSuffix : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {customer && customerProperties.length === 0 && (
              <p className="text-[0.8rem] text-muted-foreground">
                <Link href={`/properties/new?customer=${customer.id}`} className="text-link underline-offset-4 hover:underline">
                  {f.addPropertyFirst}
                </Link>
                {f.addPropertyFirstTail}
              </p>
            )}
          </Field>
          {mode === "edit" && (
            // swap the visit's invoice for another of the customer's, if needed
            <Field label={tr("Invoice")} error={serverErrors.invoiceId}>
              <input type="hidden" name="invoiceId" value={invoiceId} />
              {theirInvoices.length === 0 ? (
                <p className="text-[0.8rem] text-muted-foreground">{tr("No draft or open invoices on this customer's account.")}</p>
              ) : (
                <div role="radiogroup" aria-label={tr("Invoice")} className="grid grid-cols-2 gap-3 rounded-xl sm:grid-cols-3">
                  {theirInvoices.map((i) => (
                    <ChoiceTile key={i.id} radio title={`${invoiceNo(i.number)} · ${usd(i.totalCents)}`} sub={[due(i.dueDate), i.description].filter(Boolean).join(" · ") || undefined} on={invoiceId === String(i.id)} onClick={() => setInvoiceId(String(i.id))} />
                  ))}
                </div>
              )}
            </Field>
          )}
          {mode === "create" && (
            <Field label={tr("Invoice")} error={serverErrors.invoiceId}>
              {token && <input type="hidden" name="token" value={token} />}
              {useRecurring && recurring ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-green/40 bg-brand-green/[0.06] p-3">
                  <input type="hidden" name="billing" value="recurring" />
                  <input type="hidden" name="memorizedId" value={recurring.id} />
                  <Repeat className="size-5 shrink-0 text-brand-green" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {tr("Recurring invoice")} · {tr(frequencyLabel[recurring.frequency])} · {usd(recurring.totalCents)}
                    </span>
                    <span className="block text-[0.8rem] text-muted-foreground">{tr("A draft is made from it when you book.")}</span>
                  </span>
                  <button type="button" onClick={() => setBillDifferently(true)} className="text-sm text-link hover:underline">
                    {tr("Bill this visit differently")}
                  </button>
                </div>
              ) : (
                <input type="hidden" name="invoiceId" value={invoiceId} />
              )}
              {useRecurring ? null : !customer ? (
                <p className="text-[0.8rem] text-muted-foreground">{tr("Choose the customer first: a visit is booked against one of their invoices.")}</p>
              ) : theirInvoices.length === 0 ? (
                <div className={cn("rounded-lg border border-dashed p-3 text-sm", bad("invoiceId") && "border-destructive ring-3 ring-destructive/20")}>
                  {canMakeInvoice ? (
                    <>
                      <p>{tr("No draft or open invoices for this customer. A visit is booked against an invoice on their account: make a draft first.")}</p>
                      <Link href={`/finances/invoices/new?customer=${customer.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })}>
                        {tr("Make an invoice")}
                      </Link>
                    </>
                  ) : (
                    <p>{tr("No draft or open invoices for this customer. A visit is booked against an invoice on their account: ask the office to make one.")}</p>
                  )}
                </div>
              ) : (
                <div role="radiogroup" aria-label={tr("Invoice")} className={cn("grid grid-cols-2 gap-3 rounded-xl sm:grid-cols-3", bad("invoiceId") && "p-1 ring-2 ring-destructive")}>
                  {theirInvoices.map((i) => (
                    <ChoiceTile
                      key={i.id}
                      radio
                      title={`${invoiceNo(i.number)} · ${usd(i.totalCents)}`}
                      sub={[due(i.dueDate), i.description].filter(Boolean).join(" · ") || undefined}
                      on={invoiceId === String(i.id)}
                      onClick={() => {
                        setInvoiceId(String(i.id));
                        clear("invoiceId");
                      }}
                    />
                  ))}
                </div>
              )}
              {!useRecurring && recurring && (
                <button
                  type="button"
                  onClick={() => {
                    setBillDifferently(false);
                    setInvoiceId("");
                    clear("invoiceId");
                  }}
                  className="justify-self-start text-sm text-link hover:underline"
                >
                  {tr("Use the recurring invoice ({amount})", { amount: usd(recurring.totalCents) })}
                </button>
              )}
            </Field>
          )}
        </div>

        <Field id="contractorIds" label={tr("Who's cleaning")} error={serverErrors.contractorIds}>
          {contractorOptions.length === 0 ? (
            <p className="text-[0.8rem] text-muted-foreground">
              {tr("No contractors yet.")}{" "}
              <Link href="/contractors/new" className="text-link underline-offset-4 hover:underline">
                {tr("Add one first")}
              </Link>
              .
            </p>
          ) : (
            <CrewPicker
              options={contractorOptions}
              value={crew}
              invalid={bad("contractorIds")}
              onChange={(ids) => {
                setCrew(ids);
                clear("contractorIds");
              }}
            />
          )}
        </Field>

        <Field label={tr("When")} error={serverErrors.date ?? serverErrors.start ?? serverErrors.end}>
          <BookingCalendar
            {...when}
            today={today}
            exactTimes={exactTimes}
            invalid={{ date: bad("date"), start: bad("start"), end: bad("end") }}
            onChange={(v) => {
              setWhen(v);
              clear("date", "start", "end");
            }}
          />
        </Field>

        <Field label={tr("Vehicles")} error={serverErrors.vehicleIds}>
          {fleet.map((id) => (
            <input key={id} type="hidden" name="vehicleIds" value={id} />
          ))}
          {vehicleOptions.length === 0 ? (
            <p className="text-[0.8rem] text-muted-foreground">
              {tr("Vehicles come from Bouncie: connect it on")}{" "}
              <Link href="/fleet?tab=setup" className="text-link underline-offset-4 hover:underline">
                {tr("Fleet → Setup")}
              </Link>
              .
            </p>
          ) : (
            <div role="group" aria-label={tr("Vehicles")} className={cn("grid grid-cols-2 gap-3 rounded-xl sm:grid-cols-3", bad("vehicleIds") && "p-1 ring-2 ring-destructive")}>
              {vehicleOptions.map((v) => {
                const on = fleet.includes(String(v.id));
                const [name, ...rest] = v.label.split(" · ");
                return (
                  <ChoiceTile
                    key={v.id}
                    icon="car"
                    title={name}
                    sub={rest.join(" · ") || undefined}
                    on={on}
                    onClick={() => {
                      setFleet(on ? fleet.filter((x) => x !== String(v.id)) : [...fleet, String(v.id)]);
                      clear("vehicleIds");
                    }}
                  />
                );
              })}
            </div>
          )}
        </Field>

        <div className="grid gap-4">
          {mode === "edit" && canSetStatus && (
            <Field id="status" label={f.status} error={serverErrors.status}>
              <NativeSelect id="status" name="status" defaultValue={initialValues.status} className="w-full">
                {appointmentStatuses.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {t.enums.appointmentStatus[s]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field id="notes" label={f.notes}>
            <Textarea id="notes" name="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={f.notesPlaceholder} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending} className="h-11 px-5">
            {pending ? t.common.saving : mode === "create" ? f.submitCreate : t.common.save}
          </Button>
          <Link href={cancelHref} className={buttonVariants({ variant: "outline", className: "h-11" })}>
            {t.common.cancel}
          </Link>
        </div>
      </form>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="top-auto bottom-0 max-h-[92dvh] translate-y-0 overflow-y-auto rounded-b-none data-[size=default]:max-w-none sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-xl data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader className="place-items-start text-left">
            <AlertDialogTitle className="text-lg font-semibold">{tr("Book this appointment?")}</AlertDialogTitle>
          </AlertDialogHeader>
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{tr("Customer")}</dt>
            <dd className="font-medium">{customer?.label}</dd>
            <dt className="text-muted-foreground">{tr("Property")}</dt>
            <dd>{propertyLabel}</dd>
            <dt className="text-muted-foreground">{tr("When")}</dt>
            <dd className="font-medium">
              {when.date && fmt.shortDay(when.date)} · {when.start && fmt.clock(when.start)} – {when.end && fmt.clock(when.end)}
            </dd>
            {useRecurring && recurring && (
              <>
                <dt className="text-muted-foreground">{tr("Invoice")}</dt>
                <dd>
                  {tr("Recurring")} · <span className="font-medium">{usd(recurring.totalCents)}</span>
                  <span className="block text-[0.75rem] text-muted-foreground">{tr("a draft is made when you book")}</span>
                </dd>
              </>
            )}
            {!useRecurring && invoice && (
              <>
                <dt className="text-muted-foreground">{tr("Invoice")}</dt>
                <dd>
                  {invoiceNo(invoice.number)} · <span className="font-medium">{usd(invoice.totalCents)}</span>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{tr("Who's cleaning")}</dt>
            <dd>{crewNames.join(", ")}</dd>
            <dt className="text-muted-foreground">{vehicleNames.length > 1 ? tr("Vehicles") : tr("Vehicle")}</dt>
            <dd>{vehicleNames.join(", ")}</dd>
            {notes.trim() && (
              <>
                <dt className="text-muted-foreground">{tr("Notes")}</dt>
                <dd className="whitespace-pre-wrap">{notes.trim()}</dd>
              </>
            )}
          </dl>
          <div className="grid gap-2">
            <p className="text-sm font-semibold">{when.date && fmt.shortDay(when.date)}</p>
            {confirm?.day ? (
              <DayView items={[...confirm.day, { id: "new", start: when.start, end: when.end, title: customer?.label.replace(/\s\(.*$/, "") ?? "", sub: crewNames.map((n) => n.split(" ")[0]).join(", ") }]} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{tr("Loading the day…")}</p>
            )}
          </div>
          {/* kept in reach while the day scrolls */}
          <AlertDialogFooter className="sticky bottom-0 z-20 -mb-4 bg-muted">
            <AlertDialogCancel className="h-11">{tr("Go back")}</AlertDialogCancel>
            <Button
              type="button"
              className="h-11"
              disabled={pending || !confirm}
              onClick={() => {
                const data = confirm!.data;
                setConfirm(null);
                startTransition(() => formAction(data));
              }}
            >
              {tr("Confirm and book")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

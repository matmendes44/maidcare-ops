"use client";

import Link from "next/link";
import { cn } from "cn";
import { startTransition, useActionState, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/i18n-provider";
import { AddressFields } from "../properties/address-fields";
import type { CustomerFormState } from "./actions";
import {
  customerFields,
  customerStatuses,
  customerTypes,
  endReasons,
  FIRST_PROPERTY_PREFIX,
  normalizeCustomerForm,
  type CustomerField,
  type CustomerFormValues,
  type CustomerStatus,
  type CustomerType,
  type EndReason,
} from "./options";

type Change = { field: CustomerField; from: string; to: string };

function Field({
  name,
  required,
  hint,
  error,
  className,
  children,
}: {
  name: CustomerField;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className={className ?? "grid content-start gap-1.5"}>
      <Label htmlFor={name}>
        {t.customers.fields[name]}
        {required && <span aria-hidden="true">*</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="text-[0.8rem] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[0.8rem] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function CustomerForm({
  mode,
  action,
  initialValues,
  referrers,
  properties = [],
  cancelHref,
  canEditStripe = false,
  canEditAccount = true,
}: {
  mode: "create" | "edit";
  action: (prev: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  initialValues: CustomerFormValues;
  referrers: { id: number; label: string }[];
  // the customer's properties, to choose a billing address from (edit only)
  properties?: { id: number; label: string }[];
  cancelHref: string;
  // linking a Stripe customer by hand needs the stripe.manage permission
  canEditStripe?: boolean;
  // changing the customer code and status (customers.editAccount)
  canEditAccount?: boolean;
}) {
  const { t, fmt } = useI18n();
  const [state, formAction, pending] = useActionState(action, {});
  const [confirming, setConfirming] = useState<{ formData: FormData; changes: Change[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Controlled so the inactive fields can appear as soon as it's selected.
  const [status, setStatus] = useState(initialValues.status);
  const errors = state.errors ?? {};
  const initialReasons = initialValues.endReasons.split(",");
  // Mirrors the server rule: reasons are required when a customer is *set* to inactive.
  const reasonsRequired = mode === "create" || initialValues.status !== "inactive";

  const referrerLabels = new Map(referrers.map((r) => [String(r.id), r.label]));
  const propertyLabels = new Map(properties.map((p) => [String(p.id), p.label]));
  const display = (field: CustomerField, value: string) => {
    if (!value) return t.common.empty;
    if (field === "type") return t.enums.customerType[value as CustomerType] ?? value;
    if (field === "status") return t.enums.customerStatus[value as CustomerStatus] ?? value;
    if (field === "referredById") return referrerLabels.get(value) ?? `#${value}`;
    if (field === "billingPropertyId") return propertyLabels.get(value) ?? `#${value}`;
    if (field === "startDate" || field === "endDate") return fmt.calendarDate(value);
    if (field === "endReasons")
      return value
        .split(",")
        .map((r) => t.enums.endReason[r as EndReason] ?? r)
        .join(", ");
    return value;
  };

  // The form is submitted by hand rather than through `action=` so that React
  // doesn't reset the inputs, and so edits can be confirmed before saving.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const formData = new FormData(event.currentTarget);

    if (mode === "create") {
      startTransition(() => formAction(formData));
      return;
    }

    const next = normalizeCustomerForm(formData);
    const changes = customerFields
      // the Stripe id isn't on the form without permission, so it isn't a change
      .filter((field) => canEditStripe || field !== "stripeCustomerId")
      .filter((field) => next[field] !== initialValues[field])
      .map((field) => ({ field, from: initialValues[field], to: next[field] }));

    if (changes.length === 0) {
      setNotice(t.customers.form.nothingChanged);
      return;
    }
    setConfirming({ formData, changes });
  }

  function confirm() {
    if (!confirming) return;
    const { formData } = confirming;
    setConfirming(null);
    startTransition(() => formAction(formData));
  }

  const field = (name: CustomerField) => ({
    id: name,
    name,
    defaultValue: initialValues[name],
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  return (
    <>
      <form onSubmit={onSubmit} className="mt-6 grid gap-6" noValidate>
        {state.message && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.message}
          </p>
        )}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-base font-semibold">{t.customers.form.account}</legend>
          <Field
            name="customerCode"
            required
            error={errors.customerCode}
            hint={mode === "create" ? t.customers.form.nextCode : undefined}
          >
            <Input {...field("customerCode")} required autoComplete="off" readOnly={!canEditAccount} className={cn("font-mono", !canEditAccount && "bg-muted text-muted-foreground")} />
          </Field>
          <Field name="type" required error={errors.type}>
            <NativeSelect {...field("type")} className="w-full">
              {customerTypes.map((v) => (
                <NativeSelectOption key={v} value={v}>{t.enums.customerType[v]}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {!canEditAccount ? (
            <input type="hidden" name="status" value={status} />
          ) : (
          <Field name="status" required error={errors.status}>
            <NativeSelect
              {...field("status")}
              defaultValue={undefined}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full"
            >
              {customerStatuses.map((s) => (
                <NativeSelectOption key={s} value={s}>{t.enums.customerStatus[s]}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          )}
          <Field name="startDate" required error={errors.startDate}>
            <Input {...field("startDate")} type="date" required />
          </Field>
        </fieldset>

        {/* without access to the status, its end date and reasons go along unchanged */}
        {!canEditAccount && status === "inactive" && (
          <>
            <input type="hidden" name="endDate" value={initialValues.endDate} />
            {initialReasons.filter(Boolean).map((r) => (
              <input key={r} type="hidden" name="endReasons" value={r} />
            ))}
          </>
        )}
        {canEditAccount && status === "inactive" && (
          <fieldset className="grid gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">{t.customers.form.inactive}</legend>
            <Field name="endDate" required error={errors.endDate}>
              <Input {...field("endDate")} type="date" required />
            </Field>
            <fieldset
              className="grid gap-2 sm:col-span-2"
              aria-invalid={errors.endReasons ? true : undefined}
              aria-describedby={errors.endReasons ? "endReasons-error" : undefined}
            >
              <legend className="mb-1.5 text-sm font-medium">
                {t.customers.fields.endReasons}
                {reasonsRequired && <span aria-hidden="true">*</span>}
              </legend>
              {endReasons.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="endReasons"
                    value={r}
                    defaultChecked={initialReasons.includes(r)}
                    className="size-4 accent-primary"
                  />
                  {t.enums.endReason[r]}
                </label>
              ))}
              {errors.endReasons ? (
                <p id="endReasons-error" className="text-[0.8rem] text-destructive">{errors.endReasons}</p>
              ) : (
                <p className="text-[0.8rem] text-muted-foreground">
                  {reasonsRequired ? t.customers.form.chooseOne : t.customers.form.reasonsOptional}
                </p>
              )}
            </fieldset>
          </fieldset>
        )}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-base font-semibold">{t.customers.form.name}</legend>
          <Field name="firstName" error={errors.firstName}>
            <Input {...field("firstName")} autoComplete="off" autoFocus={mode === "create"} />
          </Field>
          <Field name="lastName" error={errors.lastName}>
            <Input {...field("lastName")} autoComplete="off" />
          </Field>
          <Field
            name="companyName"
            hint={t.customers.form.companyHint}
            error={errors.companyName}
            className="grid content-start gap-1.5 sm:col-span-2"
          >
            <Input {...field("companyName")} autoComplete="off" />
          </Field>
        </fieldset>

        {mode === "create" && (
          <fieldset>
            <legend className="mb-1 text-base font-semibold">{t.customers.form.serviceAddress}</legend>
            <p className="mb-3 text-[0.8rem] text-muted-foreground">{t.customers.form.serviceAddressHint}</p>
            <AddressFields
              prefix={FIRST_PROPERTY_PREFIX}
              errors={state.propertyErrors}
              required={false}
            />
          </fieldset>
        )}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-base font-semibold">{t.customers.form.details}</legend>
          <Field name="email" error={errors.email} className="grid content-start gap-1.5 sm:col-span-2">
            <Input {...field("email")} type="email" autoComplete="off" />
          </Field>
          <Field name="referredById" error={errors.referredById}>
            <NativeSelect {...field("referredById")} className="w-full">
              <NativeSelectOption value="">{t.customers.form.noReferral}</NativeSelectOption>
              {referrers.map((r) => (
                <NativeSelectOption key={r.id} value={r.id}>{r.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {mode === "edit" && (
            <Field
              name="billingPropertyId"
              hint={
                properties.length === 0 ? t.customers.form.billingNeedsProperty : t.customers.form.billingHint
              }
              error={errors.billingPropertyId}
              className="grid content-start gap-1.5 sm:col-span-2"
            >
              <NativeSelect
                {...field("billingPropertyId")}
                className="w-full"
                disabled={properties.length === 0}
              >
                <NativeSelectOption value="">{t.customers.form.noBilling}</NativeSelectOption>
                {properties.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>{p.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          {canEditStripe && (
            <Field name="stripeCustomerId" hint={t.customers.form.stripeHint} error={errors.stripeCustomerId}>
              <Input {...field("stripeCustomerId")} autoComplete="off" className="font-mono" />
            </Field>
          )}
          <Field name="notes" error={errors.notes} className="grid content-start gap-1.5 sm:col-span-2">
            <Textarea {...field("notes")} rows={4} />
          </Field>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? t.common.saving : mode === "create" ? t.customers.form.submitCreate : t.common.save}
          </Button>
          <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
            {t.common.cancel}
          </Link>
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
        </div>
      </form>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.customers.form.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.customers.form.confirmCount(confirming?.changes.length ?? 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="grid max-h-80 gap-3 overflow-y-auto text-sm">
            {confirming?.changes.map(({ field, from, to }) => (
              <div key={field}>
                <dt className="font-medium">{t.customers.fields[field]}</dt>
                <dd className="mt-0.5 grid gap-0.5 break-words">
                  <span className="text-muted-foreground line-through">{display(field, from)}</span>
                  <span>{display(field, to)}</span>
                </dd>
              </div>
            ))}
          </dl>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.customers.form.keepEditing}</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>{t.customers.form.confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

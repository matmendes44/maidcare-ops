"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PropertyFormState } from "./actions";
import { AddressFields } from "./address-fields";
import { CustomerPicker, type CustomerOption } from "./customer-picker";
import type { AddressValues } from "./options";

export type PropertyFormValues = AddressValues & {
  customerId: string;
  accessNotes: string;
  serviceNotes: string;
  isActive: boolean;
  isBilling: boolean;
};

export function PropertyForm({
  mode,
  action,
  customers,
  initialValues,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: PropertyFormState, formData: FormData) => Promise<PropertyFormState>;
  customers: { id: number; label: string }[];
  initialValues: Partial<PropertyFormValues>;
  cancelHref: string;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};

  const original = customers.find((c) => String(c.id) === initialValues.customerId) ?? null;
  const [customer, setCustomer] = useState<CustomerOption | null>(original);
  // On edit, choosing a different customer is a transfer.
  const transferTo = mode === "edit" && customer && original && customer.id !== original.id ? customer : null;
  // The box describes the *chosen* customer's billing address, so it's reset
  // whenever the customer changes; leaving it ticked from the old customer
  // would silently replace the new customer's billing address.
  const [billing, setBilling] = useState(Boolean(initialValues.isBilling));
  function chooseCustomer(next: CustomerOption | null) {
    setCustomer(next);
    setBilling(next !== null && next.id === original?.id ? Boolean(initialValues.isBilling) : false);
  }

  // Submitted by hand rather than through `action=` so React doesn't reset
  // the inputs when the server sends back validation errors.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-6" noValidate>
      {state.message && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <div className="grid content-start gap-1.5">
        <Label htmlFor="customerId">
          {t.properties.form.customer}<span aria-hidden="true">*</span>
        </Label>
        <CustomerPicker
          id="customerId"
          name="customerId"
          customers={customers}
          value={customer}
          onChange={chooseCustomer}
          invalid={Boolean(errors.customerId)}
          describedBy={errors.customerId ? "customerId-error" : undefined}
        />
        {errors.customerId && (
          <p id="customerId-error" className="text-[0.8rem] text-destructive">{errors.customerId}</p>
        )}
        {transferTo && original && (
          <div
            role="status"
            className="mt-1 flex gap-3 rounded-lg border border-brand-blue/30 bg-secondary/40 px-4 py-3 text-sm"
          >
            <ArrowRightLeft className="mt-0.5 size-4 shrink-0 text-brand-blue" aria-hidden="true" />
            <div className="grid gap-1">
              <p className="font-semibold">{t.properties.form.transferTitle(original.label, transferTo.label)}</p>
              <p className="text-muted-foreground">
                {t.properties.form.transferText(original.label, transferTo.label)}
                {initialValues.isBilling && t.properties.form.transferBilling(original.label)}
              </p>
            </div>
          </div>
        )}
      </div>

      <fieldset>
        <legend className="mb-3 text-base font-semibold">{t.properties.form.addressSection}</legend>
        <AddressFields initialValues={initialValues} errors={errors} />
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-3 text-base font-semibold">{t.properties.form.notesSection}</legend>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="accessNotes">{t.properties.form.accessNotes}</Label>
          <Textarea
            id="accessNotes"
            name="accessNotes"
            rows={3}
            defaultValue={initialValues.accessNotes}
            placeholder={t.properties.form.accessPlaceholder}
          />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="serviceNotes">{t.properties.form.serviceNotes}</Label>
          <Textarea
            id="serviceNotes"
            name="serviceNotes"
            rows={3}
            defaultValue={initialValues.serviceNotes}
            placeholder={t.properties.form.servicePlaceholder}
          />
        </div>
      </fieldset>

      <div className="grid gap-3">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="billing"
            checked={billing}
            onChange={(e) => setBilling(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            {t.properties.form.billing(customer?.label ?? null)}
            {(mode === "create" || transferTo) && (
              <span className="block text-[0.8rem] text-muted-foreground">
                {t.properties.form.billingAuto}
              </span>
            )}
          </span>
        </label>
        {mode === "edit" && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={initialValues.isActive}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              {t.properties.form.active}
              <span className="block text-[0.8rem] text-muted-foreground">
                {t.properties.form.activeHint}
              </span>
            </span>
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : mode === "create" ? t.properties.form.submitCreate : t.common.save}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          {t.common.cancel}
        </Link>
      </div>
    </form>
  );
}

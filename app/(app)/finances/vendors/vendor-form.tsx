"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { FormField, invalidProps } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { categories, categoryKeys } from "@/lib/expenses/options";
import type { VendorFormState } from "./actions";
import { vendorLabels as L, type VendorFormValues } from "./options";

export function VendorForm({
  mode,
  action,
  initialValues,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: VendorFormState, formData: FormData) => Promise<VendorFormState>;
  initialValues: VendorFormValues;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const f = (id: keyof VendorFormValues) => ({ ...invalidProps(id, errors[id]), defaultValue: initialValues[id] });

  return (
    <form
      // submitted by hand so React doesn't clear the fields after an error
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="mt-6 grid gap-6"
      noValidate
    >
      {state.message && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-base font-semibold">Vendor</legend>
        <div className="grid content-start gap-1.5">
          <span className="text-sm font-medium">{L.vendorCode}</span>
          <p id="vendorCode" className="flex h-9 items-center rounded-lg border border-dashed bg-muted/40 px-3 font-mono text-sm">
            {initialValues.vendorCode}
          </p>
          <p className="text-[0.8rem] text-muted-foreground">{mode === "create" ? "Assigned automatically when the vendor is saved." : "Vendor IDs don't change."}</p>
        </div>
        <FormField id="name" label={L.name} required error={errors.name}>
          <Input {...f("name")} autoComplete="off" placeholder="Example: Sams Club" />
        </FormField>
        <FormField id="defaultCategory" label={L.defaultCategory} error={errors.defaultCategory} hint="Filled in on new expenses for this vendor.">
          <NativeSelect {...f("defaultCategory")} className="w-full">
            <NativeSelectOption value="">None</NativeSelectOption>
            {categoryKeys.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {categories[c].label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {mode === "edit" && (
          <FormField id="isActive" label={L.isActive} hint="Inactive vendors are hidden from lists and new expenses.">
            <NativeSelect {...f("isActive")} className="w-full">
              <NativeSelectOption value="true">Active</NativeSelectOption>
              <NativeSelectOption value="false">Inactive</NativeSelectOption>
            </NativeSelect>
          </FormField>
        )}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-base font-semibold">Contact</legend>
        <FormField id="contactName" label={L.contactName} error={errors.contactName}>
          <Input {...f("contactName")} autoComplete="off" />
        </FormField>
        <FormField id="phone" label={L.phone} error={errors.phone}>
          <Input {...f("phone")} type="tel" autoComplete="off" />
        </FormField>
        <FormField id="email" label={L.email} error={errors.email}>
          <Input {...f("email")} type="email" autoComplete="off" />
        </FormField>
        <FormField id="website" label={L.website} error={errors.website}>
          <Input {...f("website")} inputMode="url" autoComplete="off" placeholder="Example: samsclub.com" />
        </FormField>
        <FormField id="address" label={L.address} error={errors.address} className="grid content-start gap-1.5 sm:col-span-2">
          <Input {...f("address")} autoComplete="off" />
        </FormField>
        <FormField id="accountNumber" label={L.accountNumber} error={errors.accountNumber} hint="Membership, customer or policy number.">
          <Input {...f("accountNumber")} autoComplete="off" />
        </FormField>
      </fieldset>
      <FormField id="notes" label={L.notes} error={errors.notes}>
        <Textarea {...f("notes")} rows={3} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add vendor" : "Save changes"}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

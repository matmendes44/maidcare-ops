"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { Lock } from "lucide-react";
import { FormField, invalidProps } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { taxClassifications } from "@/lib/contractors/tax";
import type { ContractorFormState } from "./actions";
import type { ContractorFormValues } from "./options";

export function ContractorForm({
  mode,
  action,
  initialValues,
  cancelHref,
  withTax,
  tinOnFile,
}: {
  mode: "create" | "edit";
  action: (prev: ContractorFormState, formData: FormData) => Promise<ContractorFormState>;
  initialValues: ContractorFormValues;
  cancelHref: string;
  // tax fields need the contractors.tax permission
  withTax: boolean;
  // masked, e.g. "•••-••-6789"
  tinOnFile: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const f = (id: keyof ContractorFormValues) => ({ ...invalidProps(id, errors[id]), defaultValue: initialValues[id] });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="mt-6 grid gap-6"
      noValidate
      autoComplete="off"
    >
      {state.message && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-base font-semibold">Contractor</legend>
        <p className="text-[0.8rem] text-muted-foreground sm:col-span-2">Use their legal name, as on their W-9: it goes on the 1099.</p>
        <FormField id="firstName" label="Legal first name" required error={errors.firstName}>
          <Input {...f("firstName")} />
        </FormField>
        <FormField id="lastName" label="Legal last name" required error={errors.lastName}>
          <Input {...f("lastName")} />
        </FormField>
        <FormField id="businessName" label="Business name (if any)" error={errors.businessName}>
          <Input {...f("businessName")} placeholder="Example: Maria's Cleaning LLC" />
        </FormField>
        <FormField id="startDate" label="Started" error={errors.startDate}>
          <Input {...f("startDate")} type="date" />
        </FormField>
        {mode === "create" && (
          <FormField id="dayRate" label="Day rate" error={errors.dayRate} hint="What they're paid for each day they work. You can change it later; past days keep their rate.">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input {...f("dayRate")} inputMode="decimal" placeholder="0.00" className="pl-6 tabular-nums" />
            </div>
          </FormField>
        )}
        {mode === "edit" && (
          <FormField id="isActive" label="Status" hint="Inactive contractors can't be put on new appointments.">
            <NativeSelect {...f("isActive")} className="w-full">
              <NativeSelectOption value="true">Active</NativeSelectOption>
              <NativeSelectOption value="false">Inactive</NativeSelectOption>
            </NativeSelect>
          </FormField>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-6">
        <legend className="mb-1 text-base font-semibold">Contact and mailing address</legend>
        <p className="text-[0.8rem] text-muted-foreground sm:col-span-6">The address their 1099 is mailed to.</p>
        <FormField id="phone" label="Phone" error={errors.phone} className="grid content-start gap-1.5 sm:col-span-3">
          <Input {...f("phone")} type="tel" />
        </FormField>
        <FormField id="email" label="Email" error={errors.email} className="grid content-start gap-1.5 sm:col-span-3">
          <Input {...f("email")} type="email" />
        </FormField>
        <FormField id="street" label="Street" error={errors.street} className="grid content-start gap-1.5 sm:col-span-6">
          <Input {...f("street")} />
        </FormField>
        <FormField id="city" label="City" error={errors.city} className="grid content-start gap-1.5 sm:col-span-3">
          <Input {...f("city")} />
        </FormField>
        <FormField id="state" label="State" error={errors.state} className="grid content-start gap-1.5 sm:col-span-1">
          <Input {...f("state")} maxLength={2} className="uppercase" />
        </FormField>
        <FormField id="zip" label="ZIP" error={errors.zip} className="grid content-start gap-1.5 sm:col-span-2">
          <Input {...f("zip")} inputMode="numeric" />
        </FormField>
      </fieldset>

      {withTax ? (
        <fieldset className="grid gap-4 rounded-lg border bg-secondary/30 p-4 sm:grid-cols-2">
          <legend className="flex items-center gap-1.5 px-1 text-base font-semibold">
            <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
            Tax details (from their W-9)
          </legend>
          <FormField id="taxClassification" label="Tax classification" error={errors.taxClassification} hint="Corporations don't get a 1099-NEC.">
            <NativeSelect {...f("taxClassification")} className="w-full">
              <NativeSelectOption value="">Not known yet</NativeSelectOption>
              {Object.entries(taxClassifications).map(([k, label]) => (
                <NativeSelectOption key={k} value={k}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="w9ReceivedOn" label="W-9 received" error={errors.w9ReceivedOn}>
            <Input {...f("w9ReceivedOn")} type="date" />
          </FormField>
          <FormField id="tinType" label="Tax ID type">
            <NativeSelect {...f("tinType")} className="w-full">
              <NativeSelectOption value="ssn">SSN (Social Security number)</NativeSelectOption>
              <NativeSelectOption value="ein">EIN (business tax ID)</NativeSelectOption>
            </NativeSelect>
          </FormField>
          <FormField
            id="tin"
            label={tinOnFile ? "New tax ID (leave blank to keep)" : "Tax ID number"}
            error={errors.tin}
            hint={tinOnFile ? `On file: ${tinOnFile}` : "Stored encrypted. Only the last 4 digits are shown afterwards."}
          >
            <Input {...invalidProps("tin", errors.tin)} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="9 digits" className="tabular-nums" />
          </FormField>
        </fieldset>
      ) : (
        <p className="flex items-center gap-2 text-[0.8rem] text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          Tax details (W-9, tax ID) are only shown to people allowed to see them.
        </p>
      )}

      <FormField id="notes" label="Notes" error={errors.notes}>
        <Textarea {...f("notes")} rows={3} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add contractor" : "Save changes"}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { FormField, invalidProps } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cardBrandKeys, cardBrands, categories, categoryKeys, frequencies, frequencyKeys, isCard, paymentMethodKeys, paymentMethods } from "@/lib/expenses/options";
import type { ExpenseFormState } from "./actions";
import type { VendorChoice } from "./expense-form";
import { VendorPicker } from "./vendor-picker";

export type ScheduleFormValues = {
  vendorId: string;
  category: string;
  amount: string;
  amountVaries: boolean;
  frequency: string;
  startDate: string;
  endDate: string;
  paymentMethod: string;
  cardBrand: string;
  cardLast4: string;
  description: string;
};

export function ScheduleForm({
  mode,
  action,
  initialValues,
  vendors,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: ExpenseFormState, formData: FormData) => Promise<ExpenseFormState>;
  initialValues: ScheduleFormValues;
  vendors: VendorChoice[];
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const [vendorId, setVendorId] = useState(initialValues.vendorId);
  const [newVendorName, setNewVendorName] = useState("");
  const [category, setCategory] = useState(initialValues.category);
  const [method, setMethod] = useState(initialValues.paymentMethod);
  const f = (id: Exclude<keyof ScheduleFormValues, "amountVaries">) => ({ ...invalidProps(id, errors[id]), defaultValue: initialValues[id] });

  return (
    <form
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
        <legend className="mb-3 text-base font-semibold">What repeats</legend>
        <FormField id="vendorId" label="Paid to (vendor)" required error={errors.vendorId}>
          <VendorPicker
            id="vendorId"
            name="vendorId"
            vendors={vendors}
            value={vendorId}
            newName={newVendorName}
            invalid={Boolean(errors.vendorId)}
            onChange={(id, v, name) => {
              setVendorId(id);
              setNewVendorName(name);
              if (v?.defaultCategory && !category) setCategory(v.defaultCategory);
            }}
          />
        </FormField>
        {vendorId === "new" ? (
          <FormField id="newVendorName" label="New vendor's name" required error={errors.newVendorName}>
            <Input {...invalidProps("newVendorName", errors.newVendorName)} value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} autoComplete="off" placeholder="Example: Sams Club" />
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
        <FormField id="category" label="Category" required error={errors.category}>
          <NativeSelect {...invalidProps("category", errors.category)} value={category} onChange={(e) => setCategory(e.target.value)} className="w-full">
            <NativeSelectOption value="">Choose a category…</NativeSelectOption>
            {categoryKeys.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {categories[c].label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="amount" label="Expected amount" required error={errors.amount}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input {...f("amount")} inputMode="decimal" autoComplete="off" placeholder="0.00" className="pl-6 tabular-nums" />
          </div>
          <label className="mt-1 flex items-center gap-2 text-[0.8rem] text-muted-foreground">
            <input type="checkbox" name="amountVaries" defaultChecked={initialValues.amountVaries} className="size-3.5 accent-brand-blue" />
            The amount changes each time (a typical amount is fine)
          </label>
        </FormField>
        <FormField id="frequency" label="How often" required error={errors.frequency}>
          <NativeSelect {...f("frequency")} className="w-full">
            {frequencyKeys.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {frequencies[k]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <div className="hidden sm:block" />
        <FormField id="startDate" label="First due date" required error={errors.startDate} hint="Later due dates follow from this one.">
          <Input {...f("startDate")} type="date" />
        </FormField>
        <FormField id="endDate" label="Last date (optional)" error={errors.endDate} hint="When it was cancelled or ends.">
          <Input {...f("endDate")} type="date" />
        </FormField>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-base font-semibold">Usually paid with</legend>
        <FormField id="paymentMethod" label="Payment method" required error={errors.paymentMethod}>
          <NativeSelect {...invalidProps("paymentMethod", errors.paymentMethod)} value={method} onChange={(e) => setMethod(e.target.value)} className="w-full">
            {paymentMethodKeys.map((m) => (
              <NativeSelectOption key={m} value={m}>
                {paymentMethods[m]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <div className="hidden sm:block" />
        {isCard(method) && (
          <>
            <FormField id="cardBrand" label="Card" error={errors.cardBrand}>
              <NativeSelect {...f("cardBrand")} className="w-full">
                <NativeSelectOption value="">Not saying</NativeSelectOption>
                {cardBrandKeys.map((b) => (
                  <NativeSelectOption key={b} value={b}>
                    {cardBrands[b]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="cardLast4" label="Last 4 digits" error={errors.cardLast4}>
              <Input {...f("cardLast4")} inputMode="numeric" maxLength={4} autoComplete="off" className="tabular-nums" />
            </FormField>
          </>
        )}
      </fieldset>
      <FormField id="description" label="Description" error={errors.description}>
        <Textarea {...f("description")} rows={2} placeholder="Business insurance policy, QuickBooks subscription…" />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add recurring expense" : "Save changes"}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

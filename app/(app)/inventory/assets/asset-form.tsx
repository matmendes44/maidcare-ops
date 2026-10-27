"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { FormField, invalidProps } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { VendorChoice } from "../../finances/expenses/expense-form";
import { PurchaseFields, type ExpenseChoice } from "../purchase-fields";

type Msg = { message?: string; errors?: Record<string, string> };

export function AssetForm({
  action,
  items,
  locations,
  vendors,
  expenses,
  today,
  defaultMethod,
  initialItem,
}: {
  action: (prev: Msg, formData: FormData) => Promise<Msg>;
  items: { id: number; name: string }[];
  locations: { id: number; name: string }[];
  vendors: VendorChoice[];
  expenses: ExpenseChoice[];
  today: string;
  defaultMethod: string;
  initialItem: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
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
        <legend className="mb-3 text-base font-semibold">Equipment</legend>
        <FormField
          id="itemId"
          label="What it is"
          required
          error={errors.itemId}
          hint={
            <>
              Not listed?{" "}
              <Link href="/inventory/items/new?kind=equipment" className="text-link underline-offset-4 hover:underline">
                Add a kind of equipment
              </Link>
            </>
          }
        >
          <NativeSelect {...invalidProps("itemId", errors.itemId)} defaultValue={initialItem} className="w-full">
            <NativeSelectOption value="">Choose…</NativeSelectOption>
            {items.map((i) => (
              <NativeSelectOption key={i.id} value={i.id}>
                {i.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="locationId" label="Kept in" required error={errors.locationId}>
          <NativeSelect {...invalidProps("locationId", errors.locationId)} defaultValue={locations[0]?.id} className="w-full">
            {locations.map((l) => (
              <NativeSelectOption key={l.id} value={l.id}>
                {l.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="serialNumber" label="Serial number" error={errors.serialNumber}>
          <Input id="serialNumber" name="serialNumber" autoComplete="off" />
        </FormField>
        <FormField id="warrantyUntil" label="Warranty until" error={errors.warrantyUntil}>
          <Input {...invalidProps("warrantyUntil", errors.warrantyUntil)} type="date" />
        </FormField>
        <FormField id="assetCost" label="This unit's cost (optional)" error={errors.assetCost} hint="When the expense covered more than this one item. Otherwise the expense's total is used.">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input {...invalidProps("assetCost", errors.assetCost)} inputMode="decimal" placeholder="0.00" className="pl-6 tabular-nums" />
          </div>
        </FormField>
        <p className="self-end text-[0.8rem] text-muted-foreground">It gets the next asset tag (A1000, A1001…) for its label.</p>
      </fieldset>
      <PurchaseFields vendors={vendors} expenses={expenses} errors={errors} today={today} withCost defaultMethod={defaultMethod} />
      <FormField id="notes" label="Notes">
        <Textarea id="notes" name="notes" rows={2} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add equipment"}
        </Button>
        <Link href="/inventory?tab=equipment" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

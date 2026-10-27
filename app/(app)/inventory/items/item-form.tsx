"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { FormField, invalidProps } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { itemCategories, itemCategoryKeys, itemKindKeys, itemKinds, units } from "@/lib/inventory/options";

type Msg = { message?: string; errors?: Record<string, string> };
export type ItemFormValues = Record<
  "name" | "kind" | "category" | "unit" | "sku" | "vehiclePar" | "reorderPoint" | "reorderQuantity" | "unitCost" | "preferredVendorId" | "serviceIntervalDays" | "usefulLifeMonths" | "notes" | "isActive",
  string
>;

export function ItemForm({
  mode,
  action,
  initialValues,
  vendors,
  storages,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: Msg, formData: FormData) => Promise<Msg>;
  initialValues: ItemFormValues;
  vendors: { id: number; label: string }[];
  storages: { id: number; name: string }[];
  cancelHref: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const [kind, setKind] = useState(initialValues.kind);
  const f = (k: keyof ItemFormValues) => ({ ...invalidProps(k, errors[k]), defaultValue: initialValues[k] });
  const counted = kind !== "equipment";

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
        <legend className="mb-3 text-base font-semibold">Item</legend>
        <FormField id="name" label="Name" required error={errors.name} className="grid content-start gap-1.5 sm:col-span-2">
          <Input {...f("name")} placeholder={kind === "equipment" ? "Example: Dyson V15 vacuum" : "Example: Swiffer duster refills"} />
        </FormField>
        <fieldset className="grid gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">How it&apos;s tracked</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {itemKindKeys.map((k) => (
              <label key={k} className={kind === k ? "grid cursor-pointer gap-0.5 rounded-lg border border-brand-blue bg-brand-blue/10 p-3" : "grid cursor-pointer gap-0.5 rounded-lg border p-3 hover:bg-secondary/40"}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-brand-blue" />
                  {itemKinds[k].label}
                </span>
                <span className="text-[0.8rem] text-muted-foreground">{itemKinds[k].hint}</span>
              </label>
            ))}
          </div>
          {errors.kind && <p className="text-[0.8rem] text-destructive">{errors.kind}</p>}
        </fieldset>
        <FormField id="category" label="Category" required error={errors.category}>
          <NativeSelect {...f("category")} className="w-full">
            <NativeSelectOption value="">Choose…</NativeSelectOption>
            {itemCategoryKeys.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {itemCategories[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {counted && (
          <FormField id="unit" label="Counted by" error={errors.unit} hint="Whole units: bottles, rolls, packs.">
            <NativeSelect {...f("unit")} className="w-full">
              {units.map((u) => (
                <NativeSelectOption key={u} value={u}>
                  {u}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <FormField id="sku" label="SKU or barcode" error={errors.sku}>
          <Input {...f("sku")} />
        </FormField>
        <FormField id="preferredVendorId" label="Usually bought from" error={errors.preferredVendorId}>
          <NativeSelect {...f("preferredVendorId")} className="w-full">
            <NativeSelectOption value="">Any store</NativeSelectOption>
            {vendors.map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {v.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </fieldset>

      {counted ? (
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-1 text-base font-semibold">Stock levels</legend>
          <p className="text-[0.8rem] text-muted-foreground sm:col-span-3">These drive the colors, the shopping list and vehicle restocks.</p>
          <FormField id="vehiclePar" label="Per vehicle (load-out)" error={errors.vehiclePar} hint="How many each vehicle should carry. 0 if it stays in storage.">
            <Input {...f("vehiclePar")} inputMode="numeric" />
          </FormField>
          <FormField id="reorderPoint" label="Reorder at" error={errors.reorderPoint} hint="Storage is low at or under this.">
            <Input {...f("reorderPoint")} inputMode="numeric" />
          </FormField>
          <FormField id="reorderQuantity" label="Usually buy" error={errors.reorderQuantity} hint="Minimum to order at once.">
            <Input {...f("reorderQuantity")} inputMode="numeric" />
          </FormField>
          <FormField id="unitCost" label="Cost per unit" error={errors.unitCost} hint="Updated automatically when you receive stock.">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input {...f("unitCost")} inputMode="decimal" placeholder="0.00" className="pl-6 tabular-nums" />
            </div>
          </FormField>
          {mode === "create" && storages.length > 0 && (
            <>
              <FormField id="startQuantity" label="On hand now" error={errors.startQuantity} hint="Counted into storage as a starting point.">
                <Input id="startQuantity" name="startQuantity" inputMode="numeric" placeholder="0" />
              </FormField>
              <FormField id="storageId" label="In">
                <NativeSelect id="storageId" name="storageId" defaultValue={storages[0].id} className="w-full">
                  {storages.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
            </>
          )}
        </fieldset>
      ) : (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 text-base font-semibold">Upkeep</legend>
          <p className="text-[0.8rem] text-muted-foreground sm:col-span-2">Each unit is added under Equipment with its tag, location and purchase.</p>
          <FormField id="serviceIntervalDays" label="Service every (days)" error={errors.serviceIntervalDays} hint="Filters, belts, descaling. Blank for none.">
            <Input {...f("serviceIntervalDays")} inputMode="numeric" placeholder="90" />
          </FormField>
          <FormField id="usefulLifeMonths" label="Useful life (months)" error={errors.usefulLifeMonths} hint="For what it's worth now.">
            <Input {...f("usefulLifeMonths")} inputMode="numeric" placeholder="36" />
          </FormField>
        </fieldset>
      )}

      {mode === "edit" && (
        <FormField id="isActive" label="Status" hint="Inactive items are hidden from lists, kits and reports.">
          <NativeSelect {...f("isActive")} className="w-full sm:w-64">
            <NativeSelectOption value="true">Active</NativeSelectOption>
            <NativeSelectOption value="false">Inactive</NativeSelectOption>
          </NativeSelect>
        </FormField>
      )}
      <FormField id="notes" label="Notes" error={errors.notes}>
        <Textarea {...f("notes")} rows={2} placeholder="Dilution, where it's shelved, which model of refill…" />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add item" : "Save changes"}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { FormField, invalidProps } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cardBrandKeys, cardBrands, isCard, paymentMethodKeys, paymentMethods } from "@/lib/expenses/options";
import type { VendorChoice } from "../finances/expenses/expense-form";
import { VendorPicker } from "../finances/expenses/vendor-picker";

export type ExpenseChoice = { id: number; label: string };

// What something was bought with: a new expense (recorded here) or one that's
// already in Expenses. Field names match purchaseFrom() in actions.ts.
export function PurchaseFields({
  vendors,
  expenses,
  errors,
  today,
  withCost,
  defaultMethod,
}: {
  vendors: VendorChoice[];
  expenses: ExpenseChoice[];
  errors: Record<string, string>;
  today: string;
  // the cost is typed here (equipment), or added up from lines (deliveries)
  withCost: boolean;
  defaultMethod: string;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [vendorId, setVendorId] = useState("");
  const [newVendorName, setNewVendorName] = useState("");
  const [method, setMethod] = useState(defaultMethod);
  return (
    <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
      <legend className="px-1 text-base font-semibold">Purchase</legend>
      <div className="flex flex-wrap gap-4 text-sm sm:col-span-2" role="radiogroup" aria-label="Purchase">
        <label className="flex items-center gap-2">
          <input type="radio" name="purchase" value="new" checked={mode === "new"} onChange={() => setMode("new")} className="accent-brand-blue" />
          Record the purchase now (adds an expense)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="purchase" value="existing" checked={mode === "existing"} onChange={() => setMode("existing")} className="accent-brand-blue" />
          It&apos;s already in Expenses
        </label>
      </div>
      {mode === "existing" ? (
        <FormField id="expenseId" label="Expense" required error={errors.expenseId} className="grid content-start gap-1.5 sm:col-span-2" hint="Expenses from the last 6 months.">
          <NativeSelect {...invalidProps("expenseId", errors.expenseId)} defaultValue="" className="w-full">
            <NativeSelectOption value="">Choose the expense…</NativeSelectOption>
            {expenses.map((e) => (
              <NativeSelectOption key={e.id} value={e.id}>
                {e.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      ) : (
        <>
          <FormField id="vendorId" label="Bought from" required error={errors.vendorId}>
            <VendorPicker
              id="vendorId"
              name="vendorId"
              vendors={vendors}
              value={vendorId}
              newName={newVendorName}
              invalid={Boolean(errors.vendorId)}
              onChange={(v, _vendor, name) => {
                setVendorId(v);
                setNewVendorName(name);
              }}
            />
          </FormField>
          {vendorId === "new" ? (
            <FormField id="newVendorName" label="New store's name" required error={errors.newVendorName}>
              <Input {...invalidProps("newVendorName", errors.newVendorName)} value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="Example: Sams Club" />
            </FormField>
          ) : (
            <FormField id="purchaseDate" label="Date" required error={errors.purchaseDate}>
              <Input {...invalidProps("purchaseDate", errors.purchaseDate)} type="date" defaultValue={today} max={today} />
            </FormField>
          )}
          {vendorId === "new" && (
            <FormField id="purchaseDate" label="Date" required error={errors.purchaseDate}>
              <Input {...invalidProps("purchaseDate", errors.purchaseDate)} type="date" defaultValue={today} max={today} />
            </FormField>
          )}
          {withCost && (
            <FormField id="cost" label="Total paid" required error={errors.cost}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input {...invalidProps("cost", errors.cost)} inputMode="decimal" placeholder="0.00" className="pl-6 tabular-nums" />
              </div>
            </FormField>
          )}
          <FormField id="paymentMethod" label="Paid with" required error={errors.paymentMethod}>
            <NativeSelect {...invalidProps("paymentMethod", errors.paymentMethod)} value={method} onChange={(e) => setMethod(e.target.value)} className="w-full">
              {paymentMethodKeys.map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {paymentMethods[m]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          {isCard(method) && (
            <>
              <FormField id="cardBrand" label="Card" error={errors.cardBrand}>
                <NativeSelect id="cardBrand" name="cardBrand" defaultValue="" className="w-full">
                  <NativeSelectOption value="">Not saying</NativeSelectOption>
                  {cardBrandKeys.map((b) => (
                    <NativeSelectOption key={b} value={b}>
                      {cardBrands[b]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="cardLast4" label="Last 4 digits" error={errors.cardLast4}>
                <Input {...invalidProps("cardLast4", errors.cardLast4)} inputMode="numeric" maxLength={4} />
              </FormField>
            </>
          )}
          <FormField id="reference" label="Receipt or order #" error={errors.reference}>
            <Input id="reference" name="reference" />
          </FormField>
          <p className="text-[0.8rem] text-muted-foreground sm:col-span-2">Saved as an expense, so it shows up in Expenses and the exports. Attach the receipt photo on the expense afterwards.</p>
        </>
      )}
    </fieldset>
  );
}

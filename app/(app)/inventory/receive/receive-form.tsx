"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { VendorChoice } from "../../finances/expenses/expense-form";
import { parseCents } from "../../finances/invoices/money";
import { PurchaseFields, type ExpenseChoice } from "../purchase-fields";

type Msg = { message?: string; errors?: Record<string, string> };
type Line = { key: number; itemId: string; qty: string; cost: string };

// A delivery or shopping trip: lines of item, quantity and what the line
// cost, into one location, paid with one expense.
export function ReceiveForm({
  action,
  items,
  locations,
  vendors,
  expenses,
  today,
  defaultMethod,
  start,
}: {
  action: (prev: Msg, formData: FormData) => Promise<Msg>;
  items: { id: number; name: string; unit: string; unitCostCents: number | null }[];
  locations: { id: number; name: string }[];
  vendors: VendorChoice[];
  expenses: ExpenseChoice[];
  today: string;
  defaultMethod: string;
  // from the shopping list: what to buy
  start: { itemId: number; qty: number }[];
}) {
  const [state, run, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const [lines, setLines] = useState<Line[]>(() => {
    const first = start.map((s, i) => {
      const item = items.find((x) => x.id === s.itemId);
      return { key: i, itemId: String(s.itemId), qty: String(s.qty), cost: item?.unitCostCents ? ((item.unitCostCents * s.qty) / 100).toFixed(2) : "" };
    });
    return first.length ? first : [{ key: 0, itemId: "", qty: "", cost: "" }];
  });
  const set = (key: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));
  const total = lines.reduce((s, l) => s + (parseCents(l.cost) ?? 0), 0);

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
      <div className="grid gap-1.5 sm:w-72">
        <Label htmlFor="locationId">Put away in</Label>
        <NativeSelect id="locationId" name="locationId" defaultValue={locations[0]?.id} className="w-full">
          {locations.map((l) => (
            <NativeSelectOption key={l.id} value={l.id}>
              {l.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-base font-semibold">What came in</legend>
        <div className="hidden grid-cols-[1fr_6rem_8rem_2.25rem] gap-2 text-[0.8rem] font-medium text-muted-foreground sm:grid">
          <span>Item</span>
          <span>How many</span>
          <span>Line total</span>
          <span />
        </div>
        {lines.map((l) => {
          const item = items.find((x) => String(x.id) === l.itemId);
          return (
            <div key={l.key} className="grid grid-cols-[1fr_5rem] gap-2 sm:grid-cols-[1fr_6rem_8rem_2.25rem]">
              <NativeSelect name="lineItem" value={l.itemId} onChange={(e) => set(l.key, { itemId: e.target.value })} aria-label="Item" className="col-span-2 w-full sm:col-span-1">
                <NativeSelectOption value="">Choose an item…</NativeSelectOption>
                {items.map((i) => (
                  <NativeSelectOption key={i.id} value={i.id}>
                    {i.name} (per {i.unit})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Input name="lineQty" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} inputMode="numeric" placeholder="Qty" aria-label="How many" className="tabular-nums" />
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input name="lineCost" value={l.cost} onChange={(e) => set(l.key, { cost: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label="Line total" className="pl-6 tabular-nums" />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                <Trash2 aria-hidden="true" />
              </Button>
              {item?.unitCostCents != null && l.qty && !l.cost && <p className="col-span-full text-[0.75rem] text-muted-foreground">Last time {item.unitCostCents / 100 > 0 ? `$${(item.unitCostCents / 100).toFixed(2)}` : "free"} each</p>}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, itemId: "", qty: "", cost: "" }])}>
            <Plus aria-hidden="true" />
            Add a line
          </Button>
          <span className="text-sm">
            Total <span className="font-semibold tabular-nums">${(total / 100).toFixed(2)}</span>
          </span>
        </div>
        {errors.lines && <p className="text-[0.8rem] text-destructive">{errors.lines}</p>}
        <p className="text-[0.8rem] text-muted-foreground">
          Not in the list?{" "}
          <Link href="/inventory/items/new" className="text-link underline-offset-4 hover:underline">
            Add the item
          </Link>{" "}
          first. Equipment is added under Equipment, one unit at a time.
        </p>
      </fieldset>
      <PurchaseFields vendors={vendors} expenses={expenses} errors={errors} today={today} withCost={false} defaultMethod={defaultMethod} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Receive"}
        </Button>
        <Link href="/inventory" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

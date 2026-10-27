"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CustomerPicker, type CustomerOption } from "../../properties/customer-picker";
import type { InvoiceFormState } from "./actions";
import { parseCents, parseQuantity } from "./money";

export type InvoiceFormOptions = {
  customers: CustomerOption[];
  properties: { id: number; customerId: number; label: string; isBilling: boolean }[];
};

// serviceDate: "YYYY-MM-DD" or "" for none
export type InvoiceLineValue = { description: string; serviceDate: string; quantity: string; price: string };

export type InvoiceFormValues = {
  customerId: string;
  propertyId: string;
  dueDate: string;
  memo: string;
  lines: InvoiceLineValue[];
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
// a line's amount as the server will compute it (0 while it's not valid yet)
const lineCents = (l: { price: string; quantity: string }) => (parseCents(l.price) ?? 0) * (parseQuantity(l.quantity) ?? 0);
const blankLine = (): InvoiceLineValue & { key: number } => ({ key: Math.random(), description: "", serviceDate: "", quantity: "1", price: "" });

export function InvoiceForm({
  mode,
  action,
  options,
  initialValues,
  cancelHref,
  today,
  appointmentId,
}: {
  mode: "create" | "edit";
  action: (prev: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  options: InvoiceFormOptions;
  initialValues: InvoiceFormValues;
  cancelHref: string;
  today: string;
  appointmentId?: number;
}) {
  // one per submission attempt, so a double click or a retry of the same
  // attempt can't create two invoices; a new one after each answer, because
  // a failed attempt's draft was deleted and resubmitting must start over
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [state, formAction, pending] = useActionState(async (prev: InvoiceFormState, formData: FormData) => {
    const result = await action(prev, formData);
    setToken(crypto.randomUUID());
    return result;
  }, {});
  const errors = state.errors ?? {};
  const lineErrors = state.lineErrors ?? {};

  const [customer, setCustomer] = useState<CustomerOption | null>(
    options.customers.find((c) => String(c.id) === initialValues.customerId) ?? null,
  );
  const [propertyId, setPropertyId] = useState(initialValues.propertyId);
  const [lines, setLines] = useState(() =>
    (initialValues.lines.length ? initialValues.lines : [blankLine()]).map((l) => ({ key: Math.random(), ...l })),
  );

  const theirProperties = options.properties.filter((p) => p.customerId === customer?.id);
  function chooseCustomer(next: CustomerOption | null) {
    setCustomer(next);
    const theirs = options.properties.filter((p) => p.customerId === next?.id);
    const preferred = theirs.find((p) => p.isBilling) ?? theirs[0];
    setPropertyId(preferred ? String(preferred.id) : "");
  }

  const updateLine = (key: number, field: keyof InvoiceLineValue, value: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  const total = lines.reduce((sum, l) => sum + lineCents(l), 0);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const fieldError = (name: keyof NonNullable<InvoiceFormState["errors"]>) =>
    errors[name] && (
      <p id={`${name}-error`} className="text-[0.8rem] text-destructive">
        {errors[name]}
      </p>
    );

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-6" noValidate>
      <input type="hidden" name="token" value={token} />
      {appointmentId && <input type="hidden" name="appointmentId" value={appointmentId} />}
      {state.message && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-base font-semibold">Bill to</legend>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="customerId">
            Customer<span aria-hidden="true">*</span>
          </Label>
          {mode === "create" ? (
            <CustomerPicker
              id="customerId"
              name="customerId"
              customers={options.customers}
              value={customer}
              onChange={chooseCustomer}
              invalid={Boolean(errors.customerId)}
              describedBy={errors.customerId ? "customerId-error" : undefined}
            />
          ) : (
            // a Stripe invoice's customer can't change
            <p className="flex h-9 items-center rounded-lg border bg-muted/50 px-3 text-sm">{customer?.label}</p>
          )}
          {fieldError("customerId")}
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="propertyId">
            Property<span aria-hidden="true">*</span>
          </Label>
          <NativeSelect
            id="propertyId"
            name="propertyId"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            disabled={!customer}
            className="w-full"
            aria-invalid={errors.propertyId ? true : undefined}
          >
            <NativeSelectOption value="" disabled>
              {!customer ? "Choose a customer first" : theirProperties.length === 0 ? "This customer has no properties" : "Choose a property…"}
            </NativeSelectOption>
            {theirProperties.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.label}
                {p.isBilling ? " · billing address" : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {fieldError("propertyId") ?? (
            <p className="text-[0.8rem] text-muted-foreground">Printed on the invoice as the service address.</p>
          )}
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="dueDate">
            Due date<span aria-hidden="true">*</span>
          </Label>
          <Input id="dueDate" name="dueDate" type="date" min={today} defaultValue={initialValues.dueDate} aria-invalid={errors.dueDate ? true : undefined} />
          {fieldError("dueDate") ?? (
            <p className="text-[0.8rem] text-muted-foreground">Ignored if the customer has no email in Stripe.</p>
          )}
        </div>
        <div className="grid content-start gap-1.5 sm:col-span-2">
          <Label htmlFor="memo">Memo</Label>
          <Textarea id="memo" name="memo" rows={2} defaultValue={initialValues.memo} placeholder="Shown on the invoice, e.g. Thank you for your business!" />
          {fieldError("memo")}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-3 text-base font-semibold">Line items</legend>
        <div className="hidden grid-cols-[minmax(0,1fr)_10.5rem_5rem_8rem_7rem_2.25rem] gap-3 px-1 text-[0.8rem] font-semibold text-muted-foreground sm:grid">
          <span>Description</span>
          <span>Service date</span>
          <span>Qty</span>
          <span>Unit price</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {lines.map((line, i) => (
          <div key={line.key} className="grid gap-1">
            {/* phones: one card per line (description, then date / qty /
                price, then amount); wider screens: a row of columns */}
            <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_10.5rem_5rem_8rem_7rem_2.25rem] sm:items-center sm:gap-3 sm:border-0 sm:p-0">
              <Input
                name="lineDescription"
                aria-label={`Line ${i + 1} description`}
                placeholder="e.g. Biweekly cleaning – Oct 15"
                value={line.description}
                onChange={(e) => updateLine(line.key, "description", e.target.value)}
                className="col-span-3 sm:col-span-1"
                aria-invalid={lineErrors[i] ? true : undefined}
              />
              <Input
                name="lineServiceDate"
                type="date"
                aria-label={`Line ${i + 1} service date`}
                title="Service date (optional): when the work was done"
                value={line.serviceDate}
                onChange={(e) => updateLine(line.key, "serviceDate", e.target.value)}
                className="max-sm:col-span-3"
              />
              <Input
                name="lineQuantity"
                aria-label={`Line ${i + 1} quantity`}
                inputMode="numeric"
                value={line.quantity}
                onChange={(e) => updateLine(line.key, "quantity", e.target.value)}
              />
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  name="linePrice"
                  aria-label={`Line ${i + 1} unit price`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={line.price}
                  onChange={(e) => updateLine(line.key, "price", e.target.value)}
                  className="pl-6"
                />
              </div>
              <span className="text-right text-sm font-medium tabular-nums max-sm:col-span-2 max-sm:self-center max-sm:text-left">
                {money.format(lineCents(line) / 100)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove line ${i + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                className="max-sm:justify-self-end"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            {lineErrors[i] && <p className="px-1 text-[0.8rem] text-destructive">{lineErrors[i]}</p>}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            <Plus aria-hidden="true" />
            Add line
          </Button>
          <p className="text-base">
            Total <span className="ml-2 text-lg font-semibold tabular-nums">{money.format(total / 100)}</span>
          </p>
        </div>
        {fieldError("lines")}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create draft invoice" : "Save changes"}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
        <p className="text-sm text-muted-foreground">
          Saved as a draft in Stripe. It isn&apos;t sent or charged until you do that from the invoice.
        </p>
      </div>
    </form>
  );
}

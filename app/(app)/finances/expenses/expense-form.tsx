"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState } from "react";
import { AlertTriangle, FileText, Paperclip, Repeat, X } from "lucide-react";
import { FormField, invalidProps } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cardBrandKeys, cardBrands, categories, categoryKeys, frequencies, frequencyKeys, isCard, paymentMethodKeys, paymentMethods } from "@/lib/expenses/options";
import type { ExpenseFormState } from "./actions";
import { VendorPicker } from "./vendor-picker";
import { useI18n } from "@/components/i18n-provider";

export type ExpenseFormValues = {
  expenseDate: string;
  vendorId: string;
  category: string;
  amount: string;
  paymentMethod: string;
  cardBrand: string;
  cardLast4: string;
  reference: string;
  description: string;
  recurringExpenseId: string;
};
export type VendorChoice = { id: number; code: string; name: string; defaultCategory: string | null; isActive: boolean; isContractor?: boolean };

// Each request must stay under 4.5 MB (Vercel), so photos are shrunk here first.
const MAX_TOTAL_BYTES = 4_000_000;

export async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]*$/, "") + ".webp", { type: "image/webp" }) : file;
  } catch {
    // formats the browser can't open are sent as they are; the server decides
    return file;
  }
}

const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export function ExpenseForm({
  mode,
  action,
  initialValues,
  vendors,
  schedule,
  schedules = [],
  allowRecurring = true,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: ExpenseFormState, formData: FormData) => Promise<ExpenseFormState>;
  initialValues: ExpenseFormValues;
  vendors: VendorChoice[];
  // the recurring expense this payment belongs to, if any
  schedule?: { id: number; label: string } | null;
  // active recurring expenses, so a payment to one of their vendors can be
  // tied to it
  schedules?: { id: number; vendorId: number; label: string }[];
  // false: one-time expenses only (no Repeats); staff
  allowRecurring?: boolean;
  cancelHref: string;
}) {
  const { tr } = useI18n();
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const [vendorId, setVendorId] = useState(initialValues.vendorId);
  const [newVendorName, setNewVendorName] = useState("");
  const [category, setCategory] = useState(initialValues.category);
  const [method, setMethod] = useState(initialValues.paymentMethod);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [repeats, setRepeats] = useState("");
  // null: the default (tied when it came with a recurring expense, or on a
  // new expense to a vendor that has one); true/false once ticked or unticked
  const [linkChoice, setLinkChoice] = useState<boolean | null>(null);
  const forVendor = schedules.find((s) => String(s.vendorId) === vendorId) ?? null;
  const offered = schedule ?? forVendor;
  const linked = Boolean(offered) && (linkChoice ?? (Boolean(schedule) || mode === "create"));
  const lastSubmit = useRef<FormData | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const categoryTouched = useRef(mode === "edit");

  const f = (id: keyof ExpenseFormValues) => ({ ...invalidProps(id, errors[id]), defaultValue: initialValues[id] });
  const total = files.reduce((s, x) => s + x.size, 0);

  function chooseVendor(id: string, v: VendorChoice | null, name: string) {
    setVendorId(id);
    setNewVendorName(name);
    // the vendor's usual category, unless one was picked by hand
    if (v?.defaultCategory && !categoryTouched.current) setCategory(v.defaultCategory);
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setFileError(null);
    setPreparing(true);
    const prepared = await Promise.all([...list].map(shrinkPhoto));
    setPreparing(false);
    const next = [...files, ...prepared];
    if (next.length > 10) setFileError(tr("Up to 10 receipts per expense."));
    else if (next.reduce((s, x) => s + x.size, 0) > MAX_TOTAL_BYTES)
      setFileError(tr("These files are over 4 MB together. Save with fewer, then add the rest on the expense's page."));
    else setFiles(next);
    if (picker.current) picker.current.value = "";
  }

  function submit(formData: FormData) {
    formData.delete("receipts");
    for (const file of files) formData.append("receipts", file, file.name);
    if (!linked) formData.delete("recurringExpenseId");
    lastSubmit.current = formData;
    startTransition(() => formAction(formData));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      className="mt-6 grid gap-6"
      noValidate
    >
      {state.message && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tr(state.message)}
        </p>
      )}
      {state.duplicate && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{state.duplicate}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              const data = lastSubmit.current;
              if (!data) return;
              data.set("confirmDuplicate", "1");
              startTransition(() => formAction(data));
            }}
          >
            {tr("Save anyway")}
          </Button>
        </div>
      )}

      {offered && (
        <label className="flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2.5 text-sm">
          <input type="checkbox" checked={linked} onChange={(e) => setLinkChoice(e.target.checked)} className="size-4 accent-brand-blue" />
          <Repeat className="size-4 text-muted-foreground" aria-hidden="true" />
          {tr("Payment for the recurring expense:")} <span className="font-medium">{offered.label}</span>
          <input type="hidden" name="recurringExpenseId" value={offered.id} />
          {!linked && <span className="w-full pl-6 text-[0.75rem] text-muted-foreground">{tr("Tick it if this is one of its payments, so its due date counts as paid.")}</span>}
        </label>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-base font-semibold">{tr("Expense")}</legend>
        <FormField id="expenseDate" label={tr("Date")} required error={errors.expenseDate}>
          <Input {...f("expenseDate")} type="date" />
        </FormField>
        <FormField id="amount" label={tr("Total")} required error={errors.amount}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input {...f("amount")} inputMode="decimal" autoComplete="off" placeholder="0.00" className="pl-6 tabular-nums" />
          </div>
        </FormField>
        <FormField id="vendorId" label={tr("Paid to (vendor)")} required error={errors.vendorId}>
          <VendorPicker id="vendorId" name="vendorId" vendors={vendors} value={vendorId} newName={newVendorName} onChange={chooseVendor} invalid={Boolean(errors.vendorId)} />
        </FormField>
        {vendorId === "new" ? (
          <FormField id="newVendorName" label={tr("New vendor's name")} required error={errors.newVendorName} hint={tr("Gets the next vendor ID. Add details later on the Vendors page.")}>
            <Input
              {...invalidProps("newVendorName", errors.newVendorName)}
              value={newVendorName}
              onChange={(e) => setNewVendorName(e.target.value)}
              autoComplete="off"
              placeholder={tr("Example: Sams Club")}
            />
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
        <FormField id="category" label={tr("Category")} required error={errors.category}>
          <NativeSelect
            {...invalidProps("category", errors.category)}
            value={category}
            onChange={(e) => {
              categoryTouched.current = true;
              setCategory(e.target.value);
            }}
            className="w-full"
          >
            <NativeSelectOption value="">{tr("Choose a category…")}</NativeSelectOption>
            {categoryKeys.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {tr(categories[c].label)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {mode === "create" && !linked && allowRecurring ? (
          <FormField id="repeats" label={tr("Repeats")} error={errors.repeats} hint={repeats ? tr("Starts a recurring expense from this one, so the next ones are expected and tracked.") : undefined}>
            <NativeSelect id="repeats" name="repeats" value={repeats} onChange={(e) => setRepeats(e.target.value)} className="w-full">
              <NativeSelectOption value="">{tr("No, one-time")}</NativeSelectOption>
              {frequencyKeys.map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {tr(frequencies[k])}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-base font-semibold">{tr("How it was paid")}</legend>
        <FormField id="paymentMethod" label={tr("Payment method")} required error={errors.paymentMethod}>
          <NativeSelect {...invalidProps("paymentMethod", errors.paymentMethod)} value={method} onChange={(e) => setMethod(e.target.value)} className="w-full">
            {paymentMethodKeys.map((m) => (
              <NativeSelectOption key={m} value={m}>
                {tr(paymentMethods[m])}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {vendors.find((v) => String(v.id) === vendorId)?.isContractor && (
          <p className="rounded-md border bg-secondary/40 px-3 py-2 text-[0.8rem] sm:col-span-2">
            {isCard(method) || method === "app"
              ? tr("Paying a contractor by card, Venmo or PayPal: this won't count toward their 1099-NEC (the payment company reports it).")
              : tr("This payment counts toward the contractor's 1099-NEC.")}
          </p>
        )}
        <FormField id="reference" label={method === "check" ? tr("Check number") : tr("Reference or confirmation #")} error={errors.reference}>
          <Input {...f("reference")} autoComplete="off" />
        </FormField>
        {isCard(method) && (
          <>
            <FormField id="cardBrand" label={tr("Card")} error={errors.cardBrand}>
              <NativeSelect {...f("cardBrand")} className="w-full">
                <NativeSelectOption value="">{tr("Not saying")}</NativeSelectOption>
                {cardBrandKeys.map((b) => (
                  <NativeSelectOption key={b} value={b}>
                    {tr(cardBrands[b])}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="cardLast4" label={tr("Last 4 digits")} error={errors.cardLast4} hint={tr("Tells your cards apart in reports.")}>
              <Input {...f("cardLast4")} inputMode="numeric" maxLength={4} autoComplete="off" placeholder="1005" className="tabular-nums" />
            </FormField>
          </>
        )}
      </fieldset>

      <FormField id="description" label={tr("Description")} error={errors.description}>
        <Textarea {...f("description")} rows={3} placeholder={tr("What it was for")} />
      </FormField>

      {mode === "create" && (
        <div className="grid gap-2">
          <span className="text-sm font-medium">{tr("Receipts")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => picker.current?.click()} disabled={preparing}>
              <Paperclip aria-hidden="true" />
              {preparing ? tr("Preparing…") : tr("Attach photos or PDFs")}
            </Button>
            <span className="text-[0.8rem] text-muted-foreground">{tr("Photos are resized. Up to 4 MB together; add more after saving.")}</span>
            <input
              ref={picker}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label={tr("Receipt files")}
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>
          {files.length > 0 && (
            <ul className="grid gap-1.5">
              {files.map((file, i) => (
                <li key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-[0.8rem] text-muted-foreground">{kb(file.size)}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={tr("Remove {name}", { name: file.name })} className="grid size-6 place-items-center rounded hover:bg-secondary">
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
              <li className="text-[0.8rem] text-muted-foreground">{tr("{size} of 4 MB", { size: kb(total) })}</li>
            </ul>
          )}
          {(fileError || errors.receipts) && (
            <p role="alert" className="text-[0.8rem] text-destructive">
              {tr(fileError ?? errors.receipts ?? "")}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || preparing}>
          {pending ? tr("Saving…") : mode === "create" ? tr("Save expense") : tr("Save changes")}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          {tr("Cancel")}
        </Link>
      </div>
    </form>
  );
}

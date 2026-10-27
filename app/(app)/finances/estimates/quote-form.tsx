"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { FormField } from "@/components/form-field";
import { QuoteDocument } from "@/components/quote-document";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { QuoteContent } from "@/lib/quotes/content";
import { CustomerPicker, type CustomerOption } from "../../properties/customer-picker";
import { QuoteEditor, toContent, toDraft, type Draft } from "./quote-editor";
import { useI18n } from "@/components/i18n-provider";

type Msg = { message?: string; errors?: Record<string, string> };
type Company = { legalName: string; address: string; phone: string; shortName: string };

export function QuoteForm({
  mode,
  action,
  customers,
  properties,
  initial,
  company,
  number,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: Msg, f: FormData) => Promise<Msg>;
  customers: CustomerOption[];
  properties: { id: number; customerId: number; label: string }[];
  initial: { customerId: string; propertyId: string; internalNotes: string; content: QuoteContent };
  company: Company;
  number: number | null;
  cancelHref: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const { tr } = useI18n();
  const [customer, setCustomer] = useState<CustomerOption | null>(customers.find((c) => String(c.id) === initial.customerId) ?? null);
  const theirs = properties.filter((p) => p.customerId === customer?.id);
  const [propertyId, setPropertyId] = useState(initial.propertyId);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial.content));
  const [preview, setPreview] = useState(true);
  const content = toContent(draft);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set("content", JSON.stringify(content));
        startTransition(() => run(data));
      }}
      className="mt-6 grid gap-6"
      noValidate
    >
      {(state.message || errors.content) && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tr(state.message ?? errors.content ?? "")}
        </p>
      )}
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-3 text-base font-semibold">{tr("For")}</legend>
        <FormField id="customerId" label={tr("Customer or lead")} required error={errors.customerId} className="grid content-start gap-1.5 sm:col-span-2">
          <CustomerPicker
            id="customerId"
            name="customerId"
            customers={customers}
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              const first = properties.find((p) => p.customerId === c?.id);
              setPropertyId(first ? String(first.id) : "");
            }}
            invalid={Boolean(errors.customerId)}
          />
        </FormField>
        <FormField id="propertyId" label={tr("Service address")} error={errors.propertyId} className="grid content-start gap-1.5 sm:col-span-2">
          <NativeSelect id="propertyId" name="propertyId" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!customer} className="w-full">
            <NativeSelectOption value="">{!customer ? tr("Choose who it's for first") : theirs.length ? tr("No address") : tr("No addresses on file")}</NativeSelectOption>
            {theirs.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </fieldset>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{tr("The estimate")}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(!preview)} className="hidden xl:inline-flex">
          {preview ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {preview ? tr("Hide preview") : tr("Show preview")}
        </Button>
      </div>
      <div className={preview ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid gap-6"}>
        <QuoteEditor
          draft={draft}
          onChange={setDraft}
        />
        {preview && (
          <div className="hidden xl:block">
            <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-lg border bg-[#eef1f5] p-3">
              <div className="origin-top scale-[0.9]">
                <QuoteDocument number={number ?? 0} date={tr("(when sent)")} company={company} preparedFor={{ name: customer?.label.replace(/\s\(.*$/, "") ?? tr("Customer name"), address: theirs.find((p) => String(p.id) === propertyId)?.label ?? null }} content={content} />
              </div>
            </div>
          </div>
        )}
      </div>

      <FormField id="internalNotes" label={tr("Internal notes (not shown to the customer)")}>
        <Textarea id="internalNotes" name="internalNotes" rows={2} defaultValue={initial.internalNotes} placeholder={tr("Gate code, how they heard about us, what to mention when following up…")} />
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? tr("Saving…") : mode === "create" ? tr("Save estimate") : tr("Save changes")}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          {tr("Cancel")}
        </Link>
        {mode === "edit" && <span className="text-[0.8rem] text-muted-foreground">{tr("If it was already sent, saving makes a new version: the customer sees the update at the same link.")}</span>}
      </div>
    </form>
  );
}

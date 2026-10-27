"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { ChoiceTile } from "@/components/choice-tile";
import { FormField, invalidProps } from "@/components/form-field";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "../properties/address-fields";
import { LEAD_TYPES, type LeadFormState } from "./lead-options";
import { FIRST_PROPERTY_PREFIX } from "./options";

const typeCards = { residential: { title: "Residential", icon: "home" }, commercial: { title: "Commercial", icon: "office" } } as const;
// (the titles are translated where they're shown)

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-base font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

// Adding a lead: what kind of customer, who they are, where the cleaning
// would be and any notes. The status, customer code and Stripe link are set
// for them.
export function LeadForm({ action }: { action: (prev: LeadFormState, f: FormData) => Promise<LeadFormState> }) {
  const { t, tr } = useI18n();
  const f = t.customers.fields;
  const [state, run, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const [type, setType] = useState<(typeof LEAD_TYPES)[number]>("residential");

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
          {tr(state.message)}
        </p>
      )}

      <fieldset className="grid gap-3">
        <legend className="mb-3 text-base font-semibold">{tr("Customer type")}</legend>
        <div role="radiogroup" aria-label={tr("Customer type")} className="grid max-w-sm grid-cols-2 gap-3">
          {LEAD_TYPES.map((v) => (
            <ChoiceTile key={v} radio icon={typeCards[v].icon} title={tr(typeCards[v].title)} on={type === v} onClick={() => setType(v)} />
          ))}
        </div>
        <input type="hidden" name="type" value={type} />
        {errors.type && <p className="text-[0.8rem] text-destructive">{tr(errors.type)}</p>}
      </fieldset>

      <Section title={tr("Customer information")}>
        <FormField id="firstName" label={f.firstName} error={errors.firstName}>
          <Input {...invalidProps("firstName", errors.firstName)} autoComplete="off" autoFocus />
        </FormField>
        <FormField id="lastName" label={f.lastName} error={errors.lastName}>
          <Input {...invalidProps("lastName", errors.lastName)} autoComplete="off" />
        </FormField>
        <FormField id="companyName" label={f.companyName} hint={t.customers.form.companyHint} error={errors.companyName} className="grid content-start gap-1.5 sm:col-span-2">
          <Input {...invalidProps("companyName", errors.companyName)} autoComplete="off" />
        </FormField>
        <FormField id="phone" label={tr("Phone")} error={errors.phone}>
          <Input {...invalidProps("phone", errors.phone)} type="tel" inputMode="tel" autoComplete="off" placeholder="(410) 555-0123" />
        </FormField>
        <FormField id="email" label={f.email} error={errors.email}>
          <Input {...invalidProps("email", errors.email)} type="email" autoComplete="off" />
        </FormField>
        <p className="-mt-2 text-[0.8rem] text-muted-foreground sm:col-span-2">{tr("A phone number or an email is required.")}</p>
      </Section>

      <fieldset>
        <legend className="mb-3 text-base font-semibold">{tr("Customer address")}</legend>
        <AddressFields prefix={FIRST_PROPERTY_PREFIX} errors={state.propertyErrors} zone={false} />
      </fieldset>

      <fieldset className="grid gap-1.5">
        <legend className="mb-3 text-base font-semibold">{tr("Notes")}</legend>
        <Textarea id="notes" name="notes" aria-label={tr("Notes")} rows={4} placeholder={tr("How they heard about us, what they're looking for, best time to call…")} />
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : tr("Create lead")}
        </Button>
        <Link href="/leads" className={buttonVariants({ variant: "outline" })}>
          {t.common.cancel}
        </Link>
      </div>
    </form>
  );
}

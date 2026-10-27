"use client";

import { startTransition, useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addContact, type ContactField, type ContactFormState } from "./contact-actions";

const fields: { name: ContactField; type?: string }[] = [
  { name: "name" },
  { name: "role" },
  { name: "phone", type: "tel" },
  { name: "email", type: "email" },
];

export function AddContact({
  customerId,
  hasPrimary,
}: {
  customerId: number;
  hasPrimary: boolean;
}) {
  const { t } = useI18n();
  const labels = { name: t.contacts.name, role: t.contacts.role, phone: t.contacts.phone, email: t.contacts.email };
  const placeholders: Partial<Record<ContactField, string>> = { role: t.contacts.rolePlaceholder, phone: "(410) 555-1234" };
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ContactFormState, FormData>(
    addContact.bind(null, customerId),
    {},
  );
  const errors = state.errors ?? {};

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {t.contacts.add}
      </Button>
    );
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mt-1 grid w-full gap-4 rounded-xl border border-brand-blue/30 bg-secondary/30 p-5"
    >
      <h3 className="text-base font-semibold">{t.contacts.title}</h3>
      {state.message && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ name, type }) => (
          <div key={name} className="grid content-start gap-1.5">
            <Label htmlFor={`contact-${name}`}>{labels[name]}</Label>
            <Input
              id={`contact-${name}`}
              name={name}
              type={type ?? "text"}
              placeholder={placeholders[name]}
              autoComplete="off"
              autoFocus={name === "name"}
              aria-invalid={errors[name] ? true : undefined}
              aria-describedby={errors[name] ? `contact-${name}-error` : undefined}
            />
            {errors[name] && (
              <p id={`contact-${name}-error`} className="text-[0.8rem] text-destructive">
                {errors[name]}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isPrimary"
            defaultChecked={!hasPrimary}
            className="size-4 accent-primary"
          />
          {t.contacts.primary}
          {hasPrimary && <span className="text-muted-foreground">{t.contacts.replacesPrimary}</span>}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="smsOptIn" defaultChecked className="size-4 accent-primary" />
          {t.contacts.okToText}
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.contacts.submit}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

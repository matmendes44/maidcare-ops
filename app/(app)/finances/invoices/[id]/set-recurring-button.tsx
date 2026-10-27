"use client";

import { useState, useTransition } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { FREQUENCIES, frequencyLabel } from "@/lib/recurring/schedule";
import { setRecurringFromInvoice } from "../../../recurring-actions";

// "Set as recurring invoice": this invoice's lines become the customer's
// memorized invoice, repeating as often as chosen (it replaces theirs).
export function SetRecurringButton({ id, current }: { id: number; current: boolean }) {
  const [open, setOpen] = useState(false);
  const [every, setEvery] = useState("biweekly");
  const [pending, run] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  if (current && !open)
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-brand-green/50 bg-brand-green/10 px-3 text-sm font-medium text-brand-green">
        <Repeat className="size-4" aria-hidden="true" />
        Recurring invoice
      </span>
    );
  if (!open)
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Repeat aria-hidden="true" />
        Set as recurring invoice
      </Button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-md border p-1.5">
      <NativeSelect aria-label="How often" value={every} onChange={(e) => setEvery(e.target.value)} className="h-8">
        {FREQUENCIES.map((f) => (
          <NativeSelectOption key={f} value={f}>
            {frequencyLabel[f]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const r = await setRecurringFromInvoice(id, every);
            if (r.message) setMessage(r.message);
            else setOpen(false);
          })
        }
      >
        {pending ? "Saving…" : "Make it recurring"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {message && (
        <span role="alert" className="w-full text-sm text-destructive">
          {message}
        </span>
      )}
    </span>
  );
}

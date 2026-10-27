"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, SkipForward } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { invoiceAndBook, skipExpected } from "../recurring-actions";

// The buttons on an expected recurring visit: make its draft invoice and book
// it, or skip this one.
export function ExpectedActions({ memorizedId, day, start, end, compact }: { memorizedId: number; day: string; start: string; end: string; compact?: boolean }) {
  const [pending, run] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { tr } = useI18n();
  return (
    <span className="relative z-10 flex flex-wrap items-center justify-end gap-1.5">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const r = await invoiceAndBook(memorizedId, day, start, end);
            if (r?.message) setMessage(r.message);
          })
        }
      >
        <CalendarPlus aria-hidden="true" />
        {pending ? tr("Making the draft…") : compact ? tr("Book") : tr("Invoice & book")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label={tr("Skip this visit")}
        onClick={() => {
          if (!confirm(tr("Skip this visit? The schedule carries on from this day."))) return;
          run(async () => {
            const r = await skipExpected(memorizedId, day);
            if (r?.message) setMessage(r.message);
          });
        }}
      >
        <SkipForward aria-hidden="true" />
        {!compact && tr("Skip")}
      </Button>
      {message && (
        <span role="alert" className="w-full text-right text-[0.75rem] text-destructive">
          {message}
        </span>
      )}
    </span>
  );
}

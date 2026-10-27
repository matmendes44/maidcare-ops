"use client";

import { useState, useTransition } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FREQUENCIES, frequencyLabel } from "@/lib/recurring/schedule";
import { updateRecurring } from "../recurring-actions";

// The owner's controls for a memorized invoice: how often, a pause, or stop.
export function RecurringControls({ id, frequency, pausedUntil }: { id: number; frequency: string; pausedUntil: string | null }) {
  const [pending, run] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [pauseDay, setPauseDay] = useState(pausedUntil ?? "");
  const act = (change: Parameters<typeof updateRecurring>[1]) =>
    run(async () => {
      const r = await updateRecurring(id, change);
      setMessage(r.message ?? null);
    });
  return (
    <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
      <div className="grid gap-1.5">
        <label htmlFor={`interval-${id}`} className="text-sm font-medium">
          How often
        </label>
        <NativeSelect id={`interval-${id}`} defaultValue={frequency} disabled={pending} onChange={(e) => act({ frequency: e.target.value })}>
          {FREQUENCIES.map((f) => (
            <NativeSelectOption key={f} value={f}>
              {frequencyLabel[f]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`pause-${id}`} className="text-sm font-medium">
          {pausedUntil ? "Paused until" : "Pause until"}
        </label>
        <div className="flex gap-2">
          <Input id={`pause-${id}`} type="date" value={pauseDay} onChange={(e) => setPauseDay(e.target.value)} className="w-40" />
          {pausedUntil ? (
            <Button type="button" variant="outline" size="sm" className="h-9" disabled={pending} onClick={() => { setPauseDay(""); act({ pausedUntil: null }); }}>
              Resume now
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-9" disabled={pending || !pauseDay} onClick={() => act({ pausedUntil: pauseDay })}>
              Pause
            </Button>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={pending}
          onClick={() => confirm("Stop this recurring invoice? No more visits will be expected.") && act({ stop: true })}
        >
          Stop recurring
        </Button>
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {message}
        </p>
      )}
    </div>
  );
}

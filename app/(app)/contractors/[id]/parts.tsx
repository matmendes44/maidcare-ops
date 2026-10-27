"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { shrinkPhoto } from "../../finances/expenses/expense-form";

type Msg = { message?: string; ok?: string };

// A new day rate from a date on.
export function DayRateForm({ action, today }: { action: (prev: Msg, formData: FormData) => Promise<Msg>; today: string }) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
      className="grid gap-3 sm:grid-cols-[8rem_10rem_1fr_auto] sm:items-end"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="dayRate">New day rate</Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input id="dayRate" name="dayRate" inputMode="decimal" placeholder="0.00" className="pl-6 tabular-nums" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="effectiveFrom">Starting</Label>
        <Input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Input id="note" name="note" placeholder="Example: raise after 6 months" maxLength={200} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save rate"}
      </Button>
      {(state.message || state.ok) && (
        <p role={state.message ? "alert" : "status"} className={state.message ? "text-sm text-destructive sm:col-span-4" : "text-sm text-brand-green sm:col-span-4"}>
          {state.message ?? state.ok}
        </p>
      )}
    </form>
  );
}

// The masked tax ID, with a way to see it in full after a fresh code from
// the authenticator app. It hides itself again after a minute.
export function TaxIdReveal({ masked, action }: { masked: string; action: (prev: { tin?: string; message?: string }, formData: FormData) => Promise<{ tin?: string; message?: string }> }) {
  const [state, run, pending] = useActionState(action, {});
  const [asking, setAsking] = useState(false);
  // the result that was hidden again (by the timer or Hide)
  const [hidden, setHidden] = useState<object | null>(null);
  const shown = state.tin && hidden !== state ? state.tin : null;
  useEffect(() => {
    if (!state.tin) return;
    const t = setTimeout(() => setHidden(state), 60_000);
    return () => clearTimeout(t);
  }, [state]);

  if (shown)
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono tabular-nums">{shown}</span>
        <button
          type="button"
          onClick={() => {
            setHidden(state);
            setAsking(false);
          }}
          className="inline-flex items-center gap-1 text-[0.8rem] text-link hover:underline"
        >
          <EyeOff className="size-3.5" aria-hidden="true" />
          Hide
        </button>
      </span>
    );
  return (
    <span className="grid gap-1.5">
      <span className="inline-flex items-center gap-2">
        <span className="font-mono tabular-nums">{masked}</span>
        {!asking && (
          <button type="button" onClick={() => setAsking(true)} className="inline-flex items-center gap-1 text-[0.8rem] text-link hover:underline">
            <Eye className="size-3.5" aria-hidden="true" />
            Show
          </button>
        )}
      </span>
      {asking && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => run(data));
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" aria-label="Code from your authenticator app" className="w-32 tabular-nums" autoFocus />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Checking…" : "Show"}
          </Button>
          <button type="button" onClick={() => setAsking(false)} className="text-[0.8rem] text-muted-foreground hover:underline">
            Cancel
          </button>
          <span className="w-full text-[0.75rem] text-muted-foreground">Enter the current code from your authenticator app. Viewing is logged.</span>
          {state.message && (
            <span role="alert" className="w-full text-[0.8rem] text-destructive">
              {state.message}
            </span>
          )}
        </form>
      )}
    </span>
  );
}

// Upload a W-9, a filed 1099 (with its tax year) or another document.
export function DocumentUploader({ action, years }: { action: (prev: Msg, formData: FormData) => Promise<Msg>; years: number[] }) {
  const [state, run, pending] = useActionState(action, {});
  const [kind, setKind] = useState("w9");
  const [preparing, setPreparing] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const picked = file.current?.files?.[0];
        if (!picked) return;
        setPreparing(true);
        const prepared = await shrinkPhoto(picked);
        setPreparing(false);
        const data = new FormData(form);
        data.set("file", prepared, prepared.name);
        startTransition(() => run(data));
        form.reset();
        setKind("w9");
      }}
      className="grid gap-3 sm:grid-cols-[11rem_8rem_1fr_auto] sm:items-end"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="kind">Document</Label>
        <NativeSelect id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-full">
          <NativeSelectOption value="w9">W-9</NativeSelectOption>
          <NativeSelectOption value="1099_nec">Filed 1099-NEC</NativeSelectOption>
          <NativeSelectOption value="other">Other</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="taxYear">Tax year</Label>
        <NativeSelect id="taxYear" name="taxYear" disabled={kind !== "1099_nec"} className="w-full">
          {years.map((y) => (
            <NativeSelectOption key={y} value={y}>
              {y}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="file">PDF or photo</Label>
        <Input ref={file} id="file" type="file" accept="application/pdf,image/*" className="pt-1.5" />
      </div>
      <Button type="submit" variant="outline" disabled={pending || preparing}>
        <Upload aria-hidden="true" />
        {pending || preparing ? "Uploading…" : "Upload"}
      </Button>
      {(state.message || state.ok) && (
        <p role={state.message ? "alert" : "status"} className={state.message ? "text-sm text-destructive sm:col-span-4" : "text-sm text-brand-green sm:col-span-4"}>
          {state.message ?? state.ok}
        </p>
      )}
    </form>
  );
}

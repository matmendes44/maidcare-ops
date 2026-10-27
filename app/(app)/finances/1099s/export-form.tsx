"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Download, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExportState } from "./actions";

// Downloads the year's 1099 data. Full tax IDs need a fresh authenticator
// code; without one, tax IDs are masked.
export function ExportForm({ action }: { action: (prev: ExportState, formData: FormData) => Promise<ExportState> }) {
  const [state, run, pending] = useActionState(action, {});
  const [withTin, setWithTin] = useState(false);
  useEffect(() => {
    if (!state.file) return;
    const url = URL.createObjectURL(new Blob([state.file.body], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = state.file.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
      className="grid content-start gap-3 rounded-lg border p-4"
    >
      <h2 className="font-semibold">Export for filing</h2>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="all" value="1" className="size-4 accent-brand-blue" />
        Include everyone (not only those who need a 1099)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="withTin" value="1" checked={withTin} onChange={(e) => setWithTin(e.target.checked)} className="size-4 accent-brand-blue" />
        <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
        Include full tax ID numbers
      </label>
      {withTin && (
        <div className="flex flex-wrap items-center gap-2">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" aria-label="Code from your authenticator app" className="w-32 tabular-nums" />
          <span className="text-[0.8rem] text-muted-foreground">Current code from your authenticator app. The export is logged.</span>
        </div>
      )}
      {state.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          <Download aria-hidden="true" />
          {pending ? "Preparing…" : "Download CSV"}
        </Button>
      </div>
      <p className="text-[0.8rem] text-muted-foreground">
        Columns follow what IRS IRIS (free e-filing at irs.gov/iris) and filing services like Track1099 ask for. A file with tax IDs is sensitive: send it securely and delete your copy after filing.
      </p>
    </form>
  );
}

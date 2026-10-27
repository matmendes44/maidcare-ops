"use client";

import { startTransition, useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { syncInvoices, type SyncState } from "./actions";

export function SyncButton() {
  const [state, run, pending] = useActionState<SyncState>(syncInvoices, {});
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" disabled={pending} onClick={() => startTransition(() => run())}>
        <RefreshCw aria-hidden="true" className={cn(pending && "animate-spin")} />
        {pending ? "Syncing…" : "Sync with Stripe"}
      </Button>
      {state.ok && (
        <p role="status" className="text-sm text-success-foreground">
          {state.ok}
        </p>
      )}
      {state.message && (
        <p role="alert" className="max-w-sm text-right text-sm text-destructive">
          {state.message}
        </p>
      )}
    </div>
  );
}

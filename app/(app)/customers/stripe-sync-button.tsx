"use client";

import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { retryStripeSync, syncCustomerToStripe, type StripeActionState } from "./actions";

// "Create in Stripe" for customers not there yet; "Sync now" re-sends the
// details of one whose last automatic update failed.
export function StripeSyncButton({ customerId, mode = "create" }: { customerId: number; mode?: "create" | "sync" }) {
  const [state, run, pending] = useActionState<StripeActionState>(
    () => (mode === "create" ? syncCustomerToStripe(customerId) : retryStripeSync(customerId)),
    {},
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(() => run())}>
        {mode === "create" ? (pending ? "Creating…" : "Create in Stripe") : pending ? "Syncing…" : "Sync now"}
      </Button>
      {state.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </div>
  );
}

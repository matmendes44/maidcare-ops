"use client";

import { startTransition, useActionState, useState } from "react";
import { Link2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CustomerPicker, type CustomerOption } from "../properties/customer-picker";
import { linkStripeCustomer, type LinkState } from "./actions";

// For an invoice whose Stripe customer isn't linked to anyone in the app.
export function LinkCustomer({
  stripeCustomerId,
  stripeName,
  customers,
}: {
  stripeCustomerId: string;
  stripeName: string | null;
  customers: CustomerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [state, run, pending] = useActionState<LinkState, number>(
    (_prev, customerId) => linkStripeCustomer(stripeCustomerId, customerId),
    {},
  );

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)} className="relative z-10">
        <Link2 aria-hidden="true" />
        Link
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Link to a customer</AlertDialogTitle>
            <AlertDialogDescription>
              Which customer is Stripe&apos;s &ldquo;{stripeName ?? stripeCustomerId}&rdquo;? All of their Stripe invoices
              will be attached to that customer, the Stripe ID is saved on them, and Stripe gets their name, address and
              customer code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid content-start gap-1.5">
            <Label htmlFor={`link-${stripeCustomerId}`}>Customer</Label>
            <CustomerPicker
              id={`link-${stripeCustomerId}`}
              name="customerId"
              customers={customers}
              value={customer}
              onChange={setCustomer}
            />
          </div>
          {state.message && (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              disabled={!customer || pending}
              onClick={() =>
                customer &&
                startTransition(async () => {
                  await run(customer.id);
                })
              }
            >
              {pending ? "Linking…" : "Link customer"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

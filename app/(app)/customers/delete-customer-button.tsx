"use client";

import { startTransition, useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteCustomer, type DeleteCustomerState } from "./actions";

// Deleting is permanent here and in Stripe, so the customer code has to be
// typed to confirm.
export function DeleteCustomerButton({
  customerId,
  customerCode,
  name,
  inStripe,
}: {
  customerId: number;
  customerCode: string;
  name: string;
  inStripe: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, run, pending] = useActionState<DeleteCustomerState, string>(
    (_prev, code) => deleteCustomer(customerId, code),
    {},
  );
  const matches = typed.trim().toUpperCase() === customerCode.toUpperCase();

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => {
          setTyped("");
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        Delete
      </Button>

      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (matches) startTransition(() => run(typed));
            }}
            className="grid gap-4"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {customerCode} {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the customer with their contacts, properties and service plans
                {inStripe ? ", and deletes them in Stripe too (with any saved cards)" : ""}. It can&apos;t be
                undone. Customers with appointments or payments can&apos;t be deleted; mark them inactive instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="confirm-code">
                Type <span className="font-mono font-semibold">{customerCode}</span> to confirm
              </Label>
              <Input
                id="confirm-code"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoFocus
                className="font-mono"
              />
            </div>
            {state.message && (
              <p role="alert" className="text-sm text-destructive">
                {state.message}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Keep customer
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!matches || pending} className="bg-destructive text-white hover:bg-destructive/90">
                {pending ? "Deleting…" : "Delete permanently"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

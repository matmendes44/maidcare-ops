"use client";

import { startTransition, useActionState, useState } from "react";
import { Stamp } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { finalizeInvoice, type FinalizeInvoiceState } from "../actions";

export function FinalizeButton({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState<FinalizeInvoiceState>(() => finalizeInvoice(id), {});
  return (
    <>
      <Button variant="outline" disabled={pending} onClick={() => setOpen(true)}>
        <Stamp aria-hidden="true" />
        {pending ? "Finalizing…" : "Finalize"}
      </Button>
      {state.message && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {state.message}
        </p>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Stripe gives it the next invoice number and locks it: after this its line items, due date and memo can&apos;t
              be edited (void it and make a new one instead). It is not emailed to the customer and their card is not
              charged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                startTransition(() => run());
              }}
            >
              Finalize invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

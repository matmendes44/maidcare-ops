"use client";

import { startTransition, useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
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
import { deleteDraftInvoice, type DeleteInvoiceState } from "../actions";

export function DeleteDraftButton({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState<DeleteInvoiceState>(() => deleteDraftInvoice(id), {});
  return (
    <>
      <Button variant="destructive" disabled={pending} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
        {pending ? "Deleting…" : "Delete draft"}
      </Button>
      {state.message && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {state.message}
        </p>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft is deleted here and in Stripe. It was never numbered or sent, so nothing else changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setOpen(false);
                startTransition(() => run());
              }}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

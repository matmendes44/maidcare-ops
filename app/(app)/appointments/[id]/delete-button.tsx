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
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { deleteAppointment, type DeleteActionState } from "../actions";

export function DeleteAppointmentButton({ id, summary }: { id: number; summary: string }) {
  const [state, run, pending] = useActionState<DeleteActionState>(() => deleteAppointment(id), {});
  const { t } = useI18n();
  const m = t.appointments.remove;
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button variant="destructive" disabled={pending} onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden="true" />
        {pending ? m.deleting : t.common.delete}
      </Button>
      {state.message && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {state.message}
        </p>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.title}</AlertDialogTitle>
            <AlertDialogDescription>{m.text(summary)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.appointments.status.keep}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setConfirming(false);
                startTransition(() => run());
              }}
            >
              {m.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

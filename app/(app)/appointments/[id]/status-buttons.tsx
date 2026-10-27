"use client";

import { startTransition, useActionState, useState } from "react";
import { Ban, CheckCircle2, RotateCcw } from "lucide-react";
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
import { setAppointmentStatus, type StatusActionState } from "../actions";
import { openStatuses, type AppointmentStatus } from "../options";

// Complete / Cancel / Reopen, depending on the current status. Canceling asks
// for confirmation since it frees the vehicle's slot.
// canComplete: mark completed / reopen; canCancel: the visit can still be changed.
export function StatusButtons({ id, status, canComplete = true, canCancel = true }: { id: number; status: AppointmentStatus; canComplete?: boolean; canCancel?: boolean }) {
  const [state, run, pending] = useActionState(
    (_prev: StatusActionState, next: AppointmentStatus) => setAppointmentStatus(id, next),
    {},
  );
  const { t } = useI18n();
  const m = t.appointments.status;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const go = (next: AppointmentStatus) => startTransition(() => run(next));

  return (
    <>
      {canComplete && openStatuses.includes(status) && (
        <Button variant="outline" disabled={pending} onClick={() => go("completed")}>
          <CheckCircle2 aria-hidden="true" />
          {m.complete}
        </Button>
      )}
      {canCancel && status !== "canceled" && (
        <Button variant="outline" disabled={pending} onClick={() => setConfirmCancel(true)}>
          <Ban aria-hidden="true" />
          {m.cancel}
        </Button>
      )}
      {canComplete && !openStatuses.includes(status) && (
        <Button variant="outline" disabled={pending} onClick={() => go("pending")}>
          <RotateCcw aria-hidden="true" />
          {m.reopen}
        </Button>
      )}
      {state.message && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {state.message}
        </p>
      )}

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.cancelTitle}</AlertDialogTitle>
            <AlertDialogDescription>{m.cancelText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.keep}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmCancel(false);
                go("canceled");
              }}
            >
              {m.cancel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

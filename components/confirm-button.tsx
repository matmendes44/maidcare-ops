"use client";

import { startTransition, useActionState, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

// A button that asks before running a server action (delete, end…). The
// action redirects on success or returns a message to show in the dialog.
export function ConfirmButton({
  label,
  icon,
  title,
  description,
  confirmLabel,
  cancelLabel,
  action,
  variant = "destructive",
  size = "default",
}: {
  label: string;
  icon?: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  action: () => Promise<{ message?: string } | void>;
  variant?: "destructive" | "outline" | "ghost";
  size?: "default" | "sm" | "icon" | "icon-sm";
}) {
  const [open, setOpen] = useState(false);
  const { tr } = useI18n();
  const [state, run, pending] = useActionState(async () => {
    const result = await action();
    if (!result?.message) setOpen(false);
    return result ?? {};
  }, {});
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} aria-label={size.startsWith("icon") ? label : undefined} title={size.startsWith("icon") ? label : undefined}>
        {icon}
        {!size.startsWith("icon") && label}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {state.message && (
            <p role="alert" className="text-sm text-destructive">
              {tr(state.message)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              {cancelLabel ?? tr("Cancel")}
            </AlertDialogCancel>
            <Button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => run())}
              className={variant === "destructive" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            >
              {pending ? tr("Working…") : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

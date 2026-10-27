"use client";

import { useI18n } from "@/components/i18n-provider";
import { Label } from "@/components/ui/label";

// A labelled form control with its error or hint underneath. The control
// should use the same `id`, and aria-describedby={`${id}-error`} when invalid.
// The error is shown in the reader's language (errors come from the server in
// English, marked with phrase()).
export function FormField({
  id,
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { tr } = useI18n();
  return (
    <div className={className ?? "grid content-start gap-1.5"}>
      <Label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true">*</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[0.8rem] text-destructive">
          {tr(error)}
        </p>
      ) : hint ? (
        <p className="text-[0.8rem] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// Props that tie a control to its FormField's error.
export const invalidProps = (id: string, error?: string) => ({
  id,
  name: id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : undefined,
});

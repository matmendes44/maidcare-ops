"use client";

import { Printer } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

export function PrintButton({ variant = "default", label }: { variant?: "default" | "outline"; label?: string }) {
  const { tr } = useI18n();
  return (
    <Button type="button" variant={variant} onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden="true" />
      {label ?? tr("Print or save as PDF")}
    </Button>
  );
}

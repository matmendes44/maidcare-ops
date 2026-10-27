"use client";

import { Printer } from "lucide-react";

export function PrintLink({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-sm text-[#2f7cf6] underline-offset-4 hover:underline print:hidden">
      <Printer className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

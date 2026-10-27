"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shrinkPhoto } from "../expense-form";
import { useI18n } from "@/components/i18n-provider";

// Adds receipts to a saved expense. Photos are shrunk first so each upload
// stays under the 4 MB limit.
export function ReceiptUploader({ action }: { action: (prev: { message?: string; ok?: string }, formData: FormData) => Promise<{ message?: string; ok?: string }> }) {
  const { tr } = useI18n();
  const [state, upload, pending] = useActionState(action, {});
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setPreparing(true);
    const files = await Promise.all([...list].map(shrinkPhoto));
    setPreparing(false);
    if (input.current) input.current.value = "";
    if (files.reduce((s, f) => s + f.size, 0) > 4_000_000) {
      setError("These files are over 4 MB together. Add them a few at a time.");
      return;
    }
    const data = new FormData();
    for (const f of files) data.append("receipts", f, f.name);
    startTransition(() => upload(data));
  }

  const message = error ?? state.message;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={pending || preparing}>
        <Upload aria-hidden="true" />
        {preparing ? tr("Preparing…") : pending ? tr("Uploading…") : tr("Add receipts")}
      </Button>
      <input ref={input} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-label={tr("Add receipt files")} onChange={(e) => onFiles(e.target.files)} />
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {tr(message)}
        </p>
      ) : state.ok ? (
        <p role="status" className="text-sm text-brand-green">
          {tr(state.ok)}
        </p>
      ) : (
        <span className="text-[0.8rem] text-muted-foreground">{tr("Photos or PDFs, up to 10 per expense.")}</span>
      )}
    </div>
  );
}

"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, PackageX, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { shrinkPhoto } from "../finances/expenses/expense-form";

type Msg = { message?: string; ok?: string };
export type ReportChoices = {
  items: { id: number; name: string }[];
  assets: { id: number; tag: string; name: string }[];
  people: { id: number; name: string }[];
};

const kinds = [
  { key: "low", label: "Running low", icon: TriangleAlert, needs: "item" },
  { key: "out", label: "Ran out", icon: PackageX, needs: "item" },
  { key: "broken", label: "Broken", icon: Wrench, needs: "asset" },
  { key: "missing", label: "Missing", icon: AlertTriangle, needs: "either" },
  { key: "other", label: "Something else", icon: AlertTriangle, needs: "none" },
] as const;

// The big-button form cleaners use to report a problem: what's wrong, with
// what, who they are, and an optional photo. Used in the app and on the QR
// code page (no sign-in).
export function ReportForm({
  action,
  choices,
  locations,
  fixedAsset,
}: {
  action: (prev: Msg, formData: FormData) => Promise<Msg>;
  choices: ReportChoices;
  // in the app: which vehicle or storage; the QR page already knows
  locations?: { id: number; name: string }[];
  // the QR on a piece of equipment: only broken / missing for it
  fixedAsset?: { id: number; label: string };
}) {
  const [state, run, pending] = useActionState(action, {});
  const [kind, setKind] = useState<string>(fixedAsset ? "broken" : "low");
  const [photoName, setPhotoName] = useState<string | null>(null);
  const photo = useRef<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const needs = kinds.find((k) => k.key === kind)!.needs;
  const shown = fixedAsset ? kinds.filter((k) => k.key === "broken" || k.key === "missing" || k.key === "other") : kinds;

  if (state.ok)
    return (
      <div role="status" className="grid justify-items-center gap-3 rounded-xl border bg-card px-6 py-10 text-center">
        <CheckCircle2 className="size-10 text-brand-green" aria-hidden="true" />
        <p className="text-lg font-semibold">{state.ok}</p>
        <Button type="button" variant="outline" onClick={() => location.reload()}>
          Report something else
        </Button>
      </div>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set("kind", kind);
        data.delete("photo");
        if (photo.current) data.set("photo", photo.current, photo.current.name);
        startTransition(() => run(data));
      }}
      className="grid gap-5"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What&apos;s wrong?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shown.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
              className={cn(
                "flex min-h-14 items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-medium transition-colors",
                kind === key ? "border-brand-blue bg-brand-blue/10 text-foreground" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {locations && (
        <div className="grid gap-1.5">
          <Label htmlFor="locationId">Where</Label>
          <NativeSelect id="locationId" name="locationId" defaultValue="" className="w-full">
            <NativeSelectOption value="">Not sure</NativeSelectOption>
            {locations.map((l) => (
              <NativeSelectOption key={l.id} value={l.id}>
                {l.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}

      {fixedAsset ? (
        <p className="rounded-lg border bg-secondary/40 px-3 py-2 text-sm">
          About: <span className="font-medium">{fixedAsset.label}</span>
        </p>
      ) : (
        <>
          {(needs === "item" || needs === "either") && (
            <div className="grid gap-1.5">
              <Label htmlFor="itemId">{needs === "item" ? "Which supply?" : "Which supply (if it's a supply)?"}</Label>
              <NativeSelect id="itemId" name="itemId" defaultValue="" className="w-full">
                <NativeSelectOption value="">Choose…</NativeSelectOption>
                {choices.items.map((i) => (
                  <NativeSelectOption key={i.id} value={i.id}>
                    {i.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          {(needs === "asset" || needs === "either") && (
            <div className="grid gap-1.5">
              <Label htmlFor="assetId">{needs === "asset" ? "Which equipment?" : "Which equipment (if it's equipment)?"}</Label>
              <NativeSelect id="assetId" name="assetId" defaultValue="" className="w-full">
                <NativeSelectOption value="">Choose…</NativeSelectOption>
                {choices.assets.map((a) => (
                  <NativeSelectOption key={a.id} value={a.id}>
                    {a.name} ({a.tag})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
        </>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="note">Details {kind === "other" ? "" : "(optional)"}</Label>
        <Textarea id="note" name="note" rows={3} maxLength={1000} placeholder={kind === "broken" ? "Example: suction stopped, brush won't spin" : "Anything that helps"} />
      </div>

      {choices.people.length > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor="contractorId">Who&apos;s reporting</Label>
          <NativeSelect id="contractorId" name="contractorId" defaultValue="" className="w-full">
            <NativeSelectOption value="">Rather not say</NativeSelectOption>
            {choices.people.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => picker.current?.click()}>
          <Camera aria-hidden="true" />
          {photoName ? "Change photo" : "Add a photo"}
        </Button>
        {photoName && <span className="text-sm text-muted-foreground">{photoName}</span>}
        <input
          ref={picker}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-label="Photo"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            photo.current = await shrinkPhoto(f);
            setPhotoName(f.name);
          }}
        />
      </div>

      {state.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-12 text-base">
        {pending ? "Sending…" : "Send report"}
      </Button>
    </form>
  );
}

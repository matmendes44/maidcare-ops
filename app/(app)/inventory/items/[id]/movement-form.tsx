"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ActionForm } from "../../action-form";

type Msg = { message?: string; ok?: string };
const kinds = { transfer: "Move it", use: "Used it up", write_off: "Lost, broken or worn out", found: "Found more" } as const;

// Move stock between places, or record use, a write-off or found stock.
export function MovementForm({ action, locations }: { action: (prev: Msg, f: FormData) => Promise<Msg>; locations: { id: number; name: string; qty: number }[] }) {
  const [kind, setKind] = useState<keyof typeof kinds>("transfer");
  const place = (name: string, label: string, withQty: boolean) => (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <NativeSelect id={name} name={name} defaultValue={locations[0]?.id} className="w-full">
        {locations.map((l) => (
          <NativeSelectOption key={l.id} value={l.id}>
            {l.name}
            {withQty ? ` (${l.qty})` : ""}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
  return (
    <ActionForm action={action} resetOnOk className="rounded-lg border p-4">
      {(pending) => (
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr_1fr_6rem] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="kind">What happened</Label>
            <NativeSelect id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as keyof typeof kinds)} className="w-full">
              {Object.entries(kinds).map(([k, label]) => (
                <NativeSelectOption key={k} value={k}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {kind === "found" ? <div className="hidden sm:block" /> : place("fromLocationId", "From", true)}
          {kind === "transfer" || kind === "found" ? place("toLocationId", kind === "found" ? "Where" : "To", false) : <div className="hidden sm:block" />}
          <div className="grid gap-1.5">
            <Label htmlFor="quantity">How many</Label>
            <Input id="quantity" name="quantity" inputMode="numeric" className="tabular-nums" />
          </div>
          <div className="grid gap-1.5 sm:col-span-3">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" name="note" maxLength={300} placeholder="Example: bottle cracked" />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </ActionForm>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { assetStatusKeys, assetStatuses } from "@/lib/inventory/options";
import { cn } from "cn";
import { ActionForm } from "../../action-form";

type Msg = { message?: string; ok?: string };
const tabs = { move: "Move", status: "Change status", service: "Log service", note: "Add a note" } as const;

// Move equipment, change its status, log routine service or add a note.
export function AssetActions({ action, locations, currentLocation, status, today }: { action: (prev: Msg, f: FormData) => Promise<Msg>; locations: { id: number; name: string }[]; currentLocation: number; status: string; today: string }) {
  const [tab, setTab] = useState<keyof typeof tabs>("move");
  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap gap-1 border-b p-1.5" role="tablist">
        {Object.entries(tabs).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k as keyof typeof tabs)} className={cn("rounded-md px-3 py-1.5 text-sm", tab === k ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/50")}>
            {label}
          </button>
        ))}
      </div>
      <ActionForm key={tab} action={action} resetOnOk className="p-4">
        {(pending) => (
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="action" value={tab} />
            {tab === "move" && (
              <div className="grid gap-1.5">
                <Label htmlFor="toLocationId">Move to</Label>
                <NativeSelect id="toLocationId" name="toLocationId" defaultValue={locations.find((l) => l.id !== currentLocation)?.id} className="w-full">
                  {locations
                    .filter((l) => l.id !== currentLocation)
                    .map((l) => (
                      <NativeSelectOption key={l.id} value={l.id}>
                        {l.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </div>
            )}
            {tab === "status" && (
              <div className="grid gap-1.5">
                <Label htmlFor="status">New status</Label>
                <NativeSelect id="status" name="status" defaultValue={assetStatusKeys.find((s) => s !== status)} className="w-full">
                  {assetStatusKeys
                    .filter((s) => s !== status)
                    .map((s) => (
                      <NativeSelectOption key={s} value={s}>
                        {assetStatuses[s].label}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </div>
            )}
            {tab === "service" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="serviceDate">Date</Label>
                  <Input id="serviceDate" name="serviceDate" type="date" defaultValue={today} max={today} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="serviceCost">Cost (optional)</Label>
                  <Input id="serviceCost" name="serviceCost" inputMode="decimal" placeholder="0.00" />
                </div>
              </div>
            )}
            <div className={cn("grid gap-1.5", tab === "note" && "sm:col-span-2")}>
              <Label htmlFor="note">{tab === "note" ? "Note" : "Note (optional)"}</Label>
              <Input id="note" name="note" maxLength={500} placeholder={tab === "service" ? "Example: new filter and belt" : tab === "status" ? "Example: sent to the repair shop" : ""} />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </ActionForm>
    </div>
  );
}

"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Check, Loader2, MapPin, RefreshCw, Unplug, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  autoRefreshFleet,
  completeVisit,
  disconnectBouncie,
  linkDevice,
  locateProperties,
  recordService,
  refreshFleet,
  setServiceInterval,
  type FleetActionState,
} from "./actions";
import { useI18n } from "@/components/i18n-provider";
import { plural } from "@/lib/i18n/tr";

function Message({ state }: { state: FleetActionState }) {
  const { tr } = useI18n();
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
      {tr(state.message)}
    </p>
  );
}

export function RefreshButton({ label }: { label?: string }) {
  const [state, run, pending] = useActionState<FleetActionState>(() => refreshFleet(), {});
  const { tr } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pending} onClick={() => startTransition(() => run())}>
        <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden="true" />
        {pending ? tr("Refreshing…") : (label ?? tr("Refresh"))}
      </Button>
      {!state.ok && <Message state={state} />}
    </div>
  );
}

// Keeps the page current while it's open and visible: asks for a sync every
// minute (the server skips it if one ran recently).
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") startTransition(() => autoRefreshFleet());
    };
    tick();
    const id = setInterval(tick, seconds * 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return null;
}

export function LocateButton({ pending: count }: { pending: number }) {
  const [state, run, pending] = useActionState<FleetActionState>(() => locateProperties(), {});
  const { tr } = useI18n();
  return (
    <div className="grid gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(() => run())}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MapPin aria-hidden="true" />}
        {pending ? tr("Looking up addresses…") : plural(tr, Math.min(count, 40), "Locate {n} property", "Locate {n} properties")}
      </Button>
      <Message state={state} />
    </div>
  );
}

export function CompleteVisitButton({ id }: { id: number }) {
  const [state, run, pending] = useActionState<FleetActionState>(() => completeVisit(id), {});
  const { tr } = useI18n();
  return (
    <>
      <Button size="sm" disabled={pending} onClick={() => startTransition(() => run())}>
        <Check aria-hidden="true" />
        {pending ? tr("Saving…") : tr("Mark completed")}
      </Button>
      <Message state={state} />
    </>
  );
}

export function LinkDevice({
  vehicleId,
  current,
  devices,
}: {
  vehicleId: number;
  current: string | null;
  devices: { imei: string; label: string; takenBy: string | null }[];
}) {
  const { tr } = useI18n();
  const [value, setValue] = useState(current ?? "");
  const [state, run, pending] = useActionState<FleetActionState, string>((_prev, imei) => linkDevice(vehicleId, imei), {});
  return (
    <div className="grid gap-1">
      <NativeSelect
        aria-label={tr("Bouncie device")}
        value={value}
        disabled={pending}
        onChange={(e) => {
          setValue(e.target.value);
          startTransition(() => run(e.target.value));
        }}
        className="w-full"
      >
        <NativeSelectOption value="">{tr("Not linked")}</NativeSelectOption>
        {devices.map((d) => (
          <NativeSelectOption key={d.imei} value={d.imei}>
            {d.label}
            {d.takenBy && d.imei !== current ? ` (${tr("now on {name}", { name: d.takenBy })})` : ""}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Message state={state} />
    </div>
  );
}

export function ServiceForm({ vehicleId, odometer, today }: { vehicleId: number; odometer: number | null; today: string }) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState<FleetActionState, FormData>((prev, fd) => recordService(vehicleId, prev, fd), {});
  if (!open)
    return (
      <div className="grid gap-1">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Wrench aria-hidden="true" />
          {tr("Record service")}
        </Button>
        {state.ok && <Message state={state} />}
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          await run(fd);
          setOpen(false);
        });
      }}
      className="grid gap-3 rounded-lg border p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`performedOn-${vehicleId}`}>{tr("Date")}</Label>
          <Input id={`performedOn-${vehicleId}`} name="performedOn" type="date" defaultValue={today} max={today} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`odometer-${vehicleId}`}>{tr("Odometer")}</Label>
          <Input id={`odometer-${vehicleId}`} name="odometer" inputMode="decimal" defaultValue={odometer != null ? Math.round(odometer) : ""} />
        </div>
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor={`note-${vehicleId}`}>{tr("What was done")}</Label>
        <Input id={`note-${vehicleId}`} name="note" placeholder={tr("e.g. Oil change, tire rotation")} maxLength={300} />
      </div>
      <Message state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? tr("Saving…") : tr("Save")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          {tr("Cancel")}
        </Button>
      </div>
    </form>
  );
}

export function IntervalForm({ vehicleId, miles }: { vehicleId: number; miles: number }) {
  const { tr } = useI18n();
  const [state, run, pending] = useActionState<FleetActionState, FormData>((prev, fd) => setServiceInterval(vehicleId, prev, fd), {});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => run(fd));
      }}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <Label htmlFor={`interval-${vehicleId}`} className="font-normal text-muted-foreground">
        {tr("Service every")}
      </Label>
      <Input id={`interval-${vehicleId}`} name="interval" defaultValue={miles} inputMode="numeric" className="h-8 w-24" />
      <span className="text-muted-foreground">miles</span>
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? tr("Saving…") : tr("Save")}
      </Button>
      <Message state={state} />
    </form>
  );
}

export function DisconnectButton() {
  const { tr } = useI18n();
  const [state, run, pending] = useActionState<FleetActionState>(() => disconnectBouncie(), {});
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (confirm(tr("Disconnect Bouncie? Vehicle data stops updating until it's connected again."))) startTransition(() => run());
        }}
      >
        <Unplug aria-hidden="true" />
        {tr("Disconnect")}
      </Button>
      <Message state={state} />
    </>
  );
}

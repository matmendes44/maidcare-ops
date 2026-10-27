"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";

type Visit = { id: number; dayLabel: string; time: string; customerName: string; address: string; price: string; crew: string | null };

// Tick the past visits a contractor worked.
export function AssignForm({ visits, action }: { visits: Visit[]; action: (prev: { message?: string }, formData: FormData) => Promise<{ message?: string }> }) {
  const [state, run, pending] = useActionState(action, {});
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData();
        for (const id of picked) data.append("appointmentId", String(id));
        startTransition(() => run(data));
      }}
      className="grid gap-3"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className="text-link hover:underline" onClick={() => setPicked(new Set(visits.map((v) => v.id)))}>
          Select all ({visits.length})
        </button>
        <button type="button" className="text-link hover:underline" onClick={() => setPicked(new Set())}>
          Clear
        </button>
        <span className="text-muted-foreground">{picked.size} selected</span>
      </div>
      <ul className="divide-y rounded-lg border text-sm">
        {visits.map((v) => (
          <li key={v.id}>
            <label className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-secondary/40">
              <input type="checkbox" checked={picked.has(v.id)} onChange={() => toggle(v.id)} className="size-4 accent-brand-blue" />
              <span className="w-28 font-medium">{v.dayLabel}</span>
              <span className="w-32 text-muted-foreground tabular-nums">{v.time}</span>
              <span>{v.customerName}</span>
              <span className="text-muted-foreground">{v.address}</span>
              <span className="ml-auto text-[0.8rem] text-muted-foreground">{v.crew ? `with ${v.crew}` : "nobody assigned yet"}</span>
            </label>
          </li>
        ))}
      </ul>
      {state.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending || picked.size === 0}>
          {pending ? "Saving…" : `Add ${picked.size || ""} ${picked.size === 1 ? "visit" : "visits"}`}
        </Button>
      </div>
    </form>
  );
}

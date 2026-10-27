"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "cn";

type Msg = { message?: string };
type Row = { id: number; name: string; unit: string; kind: string; expected: number; par: number; inSource: Record<number, number> };

// Count what's actually there. For a vehicle, each line also says how many
// to load from storage to get back to its kit (par), worked out as you type.
export function CountForm({ action, rows, restock, sources, cancelHref }: { action: (prev: Msg, f: FormData) => Promise<Msg>; rows: Row[]; restock: boolean; sources: { id: number; name: string }[]; cancelHref: string }) {
  const [state, run, pending] = useActionState(action, {});
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [loads, setLoads] = useState<Record<number, string>>({});
  const [source, setSource] = useState(sources[0]?.id ?? 0);
  const counted = (r: Row) => (counts[r.id] === undefined || counts[r.id] === "" ? r.expected : Number(counts[r.id]) || 0);
  const suggested = (r: Row) => Math.max(0, r.par - counted(r));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
      className="mt-6 grid gap-4"
      noValidate
    >
      {restock && sources.length > 0 && (
        <div className="grid gap-1.5 sm:w-72">
          <Label htmlFor="sourceId">Load from</Label>
          <NativeSelect id="sourceId" name="sourceId" value={source} onChange={(e) => setSource(Number(e.target.value))} className="w-full">
            {sources.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[0.8rem] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Should be</th>
              <th className="px-3 py-2 font-medium">Actually there</th>
              {restock && <th className="px-3 py-2 text-right font-medium">Kit</th>}
              {restock && <th className="px-3 py-2 font-medium">Load</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const c = counted(r);
              const diff = c - r.expected;
              const available = r.inSource[source] ?? 0;
              const load = loads[r.id] ?? String(suggested(r));
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <input type="hidden" name="itemId" value={r.id} />
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-[0.75rem] text-muted-foreground">per {r.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.expected}</td>
                  <td className="px-3 py-2">
                    <Input
                      name={`count-${r.id}`}
                      inputMode="numeric"
                      placeholder={String(r.expected)}
                      value={counts[r.id] ?? ""}
                      onChange={(e) => setCounts({ ...counts, [r.id]: e.target.value.replace(/\D/g, "") })}
                      aria-label={`${r.name}: how many are there`}
                      className="h-8 w-20 tabular-nums"
                    />
                    {diff !== 0 && (
                      <span className={cn("ml-2 text-[0.75rem]", diff < 0 ? "text-amber-700 dark:text-amber-400" : "text-brand-green")}>
                        {diff < 0 ? `${-diff} ${r.kind === "supply" ? "used" : "missing"}` : `${diff} found`}
                      </span>
                    )}
                  </td>
                  {restock && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.par || "—"}</td>}
                  {restock && (
                    <td className="px-3 py-2">
                      <Input name={`load-${r.id}`} inputMode="numeric" value={load} onChange={(e) => setLoads({ ...loads, [r.id]: e.target.value.replace(/\D/g, "") })} aria-label={`${r.name}: how many to load`} className="h-8 w-20 tabular-nums" />
                      {Number(load) > available && <span className="ml-2 text-[0.75rem] text-destructive">only {available} there</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[0.8rem] text-muted-foreground">
        Leave a count blank when it matches. Supplies that are short count as used; reusable items that are short (towels, mops) count as lost or worn out.
        {restock && " Loads come out of the storage you pick."}
      </p>
      {state.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || rows.length === 0}>
          {pending ? "Saving…" : restock ? "Save count and restock" : "Save count"}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

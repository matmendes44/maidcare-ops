"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { runRecurringImport } from "./actions";

type Row = {
  planId: number;
  customerId: number;
  customerCode: string;
  name: string;
  street: string;
  planFrequency: string;
  frequencyLabel: string | null;
  invoice: { id: number | null; number: string | null; status: string; day: string; totalCents: number } | null;
  lines: { description: string; cents: number }[] | null;
  decision: "create" | "skip";
  reason: string;
  warning: string | null;
};
const usd = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

// The review: what each open service plan would become. Nothing is saved
// until the owner confirms; they can leave any customer out.
export function ImportForm({ rows }: { rows: Row[] }) {
  const creatable = rows.filter((r) => r.decision === "create");
  const [chosen, setChosen] = useState<Set<number>>(new Set(creatable.map((r) => r.planId)));
  const [pending, run] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const toggle = (id: number) => setChosen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-secondary/30 p-3 text-sm">
        <span>
          <strong>{chosen.size}</strong> of {creatable.length} will get a recurring invoice · {rows.length - creatable.length} skipped
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          disabled={pending || chosen.size === 0}
          onClick={() => {
            if (!confirm(`Create ${chosen.size} recurring invoices? Nothing is created in Stripe.`)) return;
            run(async () => {
              const r = await runRecurringImport([...chosen]);
              if (r?.message) setMessage(r.message);
            });
          }}
        >
          {pending ? "Creating…" : `Create ${chosen.size} recurring invoices`}
        </Button>
        {message && (
          <p role="alert" className="w-full text-destructive">
            {message}
          </p>
        )}
      </div>

      <ul className="grid gap-2">
        {rows.map((r) => {
          const on = chosen.has(r.planId);
          return (
            <li key={r.planId} className={cn("rounded-lg border p-3 text-sm", r.decision === "skip" && "bg-muted/40 text-muted-foreground")}>
              <label className={cn("flex items-start gap-3", r.decision === "create" && "cursor-pointer")}>
                <input type="checkbox" className="mt-1 size-4 accent-brand-green" disabled={r.decision === "skip"} checked={on} onChange={() => toggle(r.planId)} aria-label={`Create a recurring invoice for ${r.name}`} />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <a href={`/customers/${r.customerId}`} className="font-semibold text-foreground hover:text-link">
                      {r.name}
                    </a>
                    <span className="font-mono text-[0.75rem]">{r.customerCode}</span>
                    <span className="text-[0.8rem]">{r.street}</span>
                  </span>
                  <span className="text-[0.8rem]">
                    Plan: {r.planFrequency.replace(/_/g, " ")}
                    {r.frequencyLabel && ` → ${r.frequencyLabel}`}
                    {r.invoice && (
                      <>
                        {" · "}latest invoice{" "}
                        {r.invoice.id ? (
                          <a href={`/finances/invoices/${r.invoice.id}`} className="text-link hover:underline">
                            {r.invoice.number ?? "(no number)"}
                          </a>
                        ) : (
                          <span className="font-medium">{r.invoice.number ?? "(no number)"}</span>
                        )}{" "}
                        ({r.invoice.status}, {r.invoice.day}, {usd(r.invoice.totalCents)})
                      </>
                    )}
                  </span>
                  {r.decision === "create" && r.lines && (
                    <span className="grid gap-0.5 rounded-md bg-secondary/40 px-2 py-1.5 text-[0.8rem] text-foreground">
                      {r.lines.map((l, i) => (
                        <span key={i} className="flex justify-between gap-3">
                          <span className="min-w-0">{l.description}</span>
                          <span className="tabular-nums">{usd(l.cents)}</span>
                        </span>
                      ))}
                    </span>
                  )}
                  {r.warning && <span className="text-[0.8rem] text-amber-700 dark:text-amber-400">{r.warning}</span>}
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.75rem] font-medium", r.decision === "create" ? "bg-brand-green/15 text-brand-green" : "bg-muted text-muted-foreground")}>
                  {r.decision === "create" ? "Create" : `Skip: ${r.reason}`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

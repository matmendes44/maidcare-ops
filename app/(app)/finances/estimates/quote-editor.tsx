"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { QuoteContent } from "@/lib/quotes/content";
import { parseCents } from "../invoices/money";

// The editable estimate: every block of the document. Prices are typed in
// dollars and kept as text while editing; toContent() turns the draft into
// the stored document.
export type Draft = Omit<QuoteContent, "options" | "addOns" | "recurring" | "areas" | "notes"> & {
  options: { id: string; name: string; description: string; price: string; recurring: string }[];
  addOns: { id: string; name: string; description: string; price: string; kind: "optional" | "on_request" }[];
  recurring: { name: string; description: string; when: string; price: string }[];
  areas: string;
  notes: string;
};

const dollars = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
const toCents = (s: string) => (s.trim() === "" ? null : parseCents(s));

export function toDraft(c: QuoteContent): Draft {
  return {
    ...c,
    options: c.options.map((o) => ({ id: o.id, name: o.name, description: o.description, price: o.priceCents ? dollars(o.priceCents) : "", recurring: dollars(o.recurringCents) })),
    addOns: c.addOns.map((a) => ({ id: a.id, name: a.name, description: a.description, price: dollars(a.priceCents), kind: a.kind })),
    recurring: c.recurring.map((r) => ({ name: r.name, description: r.description, when: r.when, price: dollars(r.priceCents) })),
    areas: c.areas.join("\n"),
    notes: c.notes.join("\n"),
  };
}

export function toContent(d: Draft): QuoteContent {
  return {
    ...d,
    options: d.options.map((o) => ({ id: o.id, name: o.name, description: o.description, priceCents: toCents(o.price) ?? 0, recurringCents: toCents(o.recurring) })),
    addOns: d.addOns.map((a) => ({ id: a.id, name: a.name, description: a.description, priceCents: toCents(a.price) ?? 0, kind: a.kind })),
    recurring: d.recurring.map((r) => ({ name: r.name, description: r.description, when: r.when, priceCents: toCents(r.price) ?? 0 })),
    areas: d.areas.split("\n").map((s) => s.trim()).filter(Boolean),
    notes: d.notes.split("\n").map((s) => s.trim()).filter(Boolean),
  };
}

const newId = (prefix: string, taken: string[]) => {
  let i = taken.length + 1;
  while (taken.includes(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
};

function move<T>(list: T[], i: number, by: number) {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-4">
      <legend className="px-1 text-base font-semibold">{title}</legend>
      {hint && <p className="-mt-1 text-[0.8rem] text-muted-foreground">{hint}</p>}
      {children}
    </fieldset>
  );
}

function RowTools({ onUp, onDown, onRemove, label }: { onUp: () => void; onDown: () => void; onRemove: () => void; label: string }) {
  const { tr } = useI18n();
  return (
    <div className="flex gap-0.5">
      <Button type="button" variant="ghost" size="icon-sm" onClick={onUp} aria-label={tr("Move {name} up", { name: label })}>
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onDown} aria-label={tr("Move {name} down", { name: label })}>
        <ArrowDown aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={tr("Remove {name}", { name: label })}>
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

const Money = ({ value, onChange, label, placeholder = "0.00" }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) => (
  <div className="relative">
    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">$</span>
    <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={placeholder} aria-label={label} className="pl-5 tabular-nums" />
  </div>
);

export function QuoteEditor({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const { tr } = useI18n();
  const columns = draft.included.columns;
  const compare = columns.length > 1;

  return (
    <div className="grid gap-5">
      <Block title={tr("Heading")}>
        <div className="grid gap-1.5">
          <Label htmlFor="q-title">{tr("Title (the blue band)")}</Label>
          <Input id="q-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder={tr("Example: First-time deep clean + organization")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="q-intro">{tr("Intro (optional)")}</Label>
          <Textarea id="q-intro" rows={2} value={draft.intro} onChange={(e) => set({ intro: e.target.value })} placeholder={tr("Example: Pick one of the two options below. After your first visit, standard cleanings continue every 2 weeks at $185.")} />
          <p className="text-[0.75rem] text-muted-foreground">{tr("With an intro, the options table comes first (like “Choose how to start”).")}</p>
        </div>
      </Block>

      <Block title={tr("Options and prices")} hint={tr("One option is a single price. Two or more, and the customer picks one when accepting.")}>
        {draft.options.map((o, i) => (
          <div key={o.id} className="grid gap-2 rounded-md border bg-secondary/20 p-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-start">
            <div className="grid gap-2">
              <Input value={o.name} onChange={(e) => set({ options: draft.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={tr("Option name, like Option 1: Deep Clean First")} aria-label={tr("Option {n} name", { n: i + 1 })} />
              <Input value={o.description} onChange={(e) => set({ options: draft.options.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} placeholder={tr("What it covers (optional)")} aria-label={tr("Option {n} description", { n: i + 1 })} />
            </div>
            <div className="grid gap-1">
              <span className="text-[0.7rem] text-muted-foreground">{tr("First visit")}</span>
              <Money value={o.price} onChange={(v) => set({ options: draft.options.map((x, j) => (j === i ? { ...x, price: v } : x)) })} label={tr("Option {n} price", { n: i + 1 })} />
            </div>
            <div className="grid gap-1">
              <span className="text-[0.7rem] text-muted-foreground">{tr("After (optional)")}</span>
              <Money value={o.recurring} onChange={(v) => set({ options: draft.options.map((x, j) => (j === i ? { ...x, recurring: v } : x)) })} label={tr("Option {n} recurring price", { n: i + 1 })} placeholder="—" />
            </div>
            <RowTools
              label={tr("option {n}", { n: i + 1 })}
              onUp={() => set({ options: move(draft.options, i, -1) })}
              onDown={() => set({ options: move(draft.options, i, 1) })}
              onRemove={() => draft.options.length > 1 && set({ options: draft.options.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ options: [...draft.options, { id: newId("o", draft.options.map((o) => o.id)), name: "", description: "", price: "", recurring: "" }] })}>
          <Plus aria-hidden="true" />
          {tr("Add an option")}
        </Button>
      </Block>

      <Block title={tr("Areas covered")} hint={tr("One line each. Leave empty to leave it off.")}>
        <Textarea rows={3} value={draft.areas} onChange={(e) => set({ areas: e.target.value })} placeholder={tr("Floors 1–3 (every visit): 2 bedrooms, 2 full bathrooms and 2 half bathrooms.")} aria-label={tr("Areas covered")} />
      </Block>

      <Block title={tr("What's included")} hint={tr("A checklist, or a comparison: name two or more levels (Standard, Deep clean) and tick what each includes.")}>
        <div className="grid gap-1.5 sm:w-96">
          <Label htmlFor="q-columns">{tr("Compare levels (optional)")}</Label>
          <Input
            id="q-columns"
            value={compare ? columns.join(", ") : ""}
            onChange={(e) => {
              const next = e.target.value.split(",").map((s) => s.trim()).slice(0, 4);
              const cols = next.filter(Boolean).length > 1 ? next : [""];
              set({ included: { columns: cols, tasks: draft.included.tasks.map((t) => ({ ...t, marks: cols.map((_, k) => t.marks[k] ?? true) })) } });
            }}
            placeholder={tr("Example: Standard, Deep clean")}
          />
        </div>
        <ul className="grid gap-1.5">
          {draft.included.tasks.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Input
                value={t.label}
                onChange={(e) => set({ included: { ...draft.included, tasks: draft.included.tasks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) } })}
                aria-label={tr("Task {n}", { n: i + 1 })}
                className="min-w-48 flex-1"
              />
              {compare &&
                columns.map((c, k) => (
                  <label key={k} className="flex items-center gap-1 text-[0.8rem]">
                    <input
                      type="checkbox"
                      checked={t.marks[k] ?? true}
                      onChange={(e) => set({ included: { ...draft.included, tasks: draft.included.tasks.map((x, j) => (j === i ? { ...x, marks: columns.map((_, m) => (m === k ? e.target.checked : (x.marks[m] ?? true))) } : x)) } })}
                      className="accent-brand-blue"
                    />
                    {c}
                  </label>
                ))}
              <RowTools
                label={tr("task {n}", { n: i + 1 })}
                onUp={() => set({ included: { ...draft.included, tasks: move(draft.included.tasks, i, -1) } })}
                onDown={() => set({ included: { ...draft.included, tasks: move(draft.included.tasks, i, 1) } })}
                onRemove={() => set({ included: { ...draft.included, tasks: draft.included.tasks.filter((_, j) => j !== i) } })}
              />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => set({ included: { ...draft.included, tasks: [...draft.included.tasks, { label: "", marks: columns.map(() => true) }] } })}>
            <Plus aria-hidden="true" />
            {tr("Add a task")}
          </Button>
          <AddSeveral onAdd={(labels) => set({ included: { ...draft.included, tasks: [...draft.included.tasks, ...labels.map((label) => ({ label, marks: columns.map(() => true) }))] } })} />
        </div>
      </Block>

      <Block title={tr("Add-ons")} hint={tr("Optional: the customer can add it when accepting. On request: listed with its price for later visits.")}>
        {draft.addOns.map((a, i) => (
          <div key={a.id} className="grid gap-2 rounded-md border bg-secondary/20 p-3 sm:grid-cols-[1fr_7rem_9rem_auto] sm:items-start">
            <div className="grid gap-2">
              <Input value={a.name} onChange={(e) => set({ addOns: draft.addOns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={tr("Example: Closet organization")} aria-label={tr("Add-on {n} name", { n: i + 1 })} />
              <Input value={a.description} onChange={(e) => set({ addOns: draft.addOns.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} placeholder={tr("Description")} aria-label={tr("Add-on {n} description", { n: i + 1 })} />
            </div>
            <Money value={a.price} onChange={(v) => set({ addOns: draft.addOns.map((x, j) => (j === i ? { ...x, price: v } : x)) })} label={tr("Add-on {n} price", { n: i + 1 })} />
            <NativeSelect value={a.kind} onChange={(e) => set({ addOns: draft.addOns.map((x, j) => (j === i ? { ...x, kind: e.target.value as "optional" | "on_request" } : x)) })} aria-label={tr("Add-on {n} kind", { n: i + 1 })} className="w-full">
              <NativeSelectOption value="optional">{tr("Optional")}</NativeSelectOption>
              <NativeSelectOption value="on_request">{tr("On request")}</NativeSelectOption>
            </NativeSelect>
            <RowTools label={tr("add-on {n}", { n: i + 1 })} onUp={() => set({ addOns: move(draft.addOns, i, -1) })} onDown={() => set({ addOns: move(draft.addOns, i, 1) })} onRemove={() => set({ addOns: draft.addOns.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ addOns: [...draft.addOns, { id: newId("a", [...draft.addOns.map((a) => a.id), ...draft.options.map((o) => o.id)]), name: "", description: "", price: "", kind: "optional" }] })}>
          <Plus aria-hidden="true" />
          {tr("Add an add-on")}
        </Button>
      </Block>

      <Block title={tr("Recurring plan")} hint={tr("What the regular visits cost after the first one. Leave empty for a one-time job.")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={draft.recurringTitle} onChange={(e) => set({ recurringTitle: e.target.value })} aria-label={tr("Recurring section title")} placeholder={tr("Recurring cleaning options")} />
          <Input value={draft.recurringIntro} onChange={(e) => set({ recurringIntro: e.target.value })} aria-label={tr("Recurring intro")} placeholder={tr("Intro (optional)")} />
        </div>
        {draft.recurring.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-md border bg-secondary/20 p-3 sm:grid-cols-[1fr_1fr_8rem_7rem_auto] sm:items-start">
            <Input value={r.name} onChange={(e) => set({ recurring: draft.recurring.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={tr("Plan, like Whole House")} aria-label={tr("Plan {n} name", { n: i + 1 })} />
            <Input value={r.description} onChange={(e) => set({ recurring: draft.recurring.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} placeholder={tr("What's included")} aria-label={tr("Plan {n} description", { n: i + 1 })} />
            <Input value={r.when} onChange={(e) => set({ recurring: draft.recurring.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)) })} placeholder={tr("Every other week")} aria-label={tr("Plan {n} when", { n: i + 1 })} />
            <Money value={r.price} onChange={(v) => set({ recurring: draft.recurring.map((x, j) => (j === i ? { ...x, price: v } : x)) })} label={tr("Plan {n} price", { n: i + 1 })} />
            <RowTools label={tr("plan {n}", { n: i + 1 })} onUp={() => set({ recurring: move(draft.recurring, i, -1) })} onDown={() => set({ recurring: move(draft.recurring, i, 1) })} onRemove={() => set({ recurring: draft.recurring.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ recurring: [...draft.recurring, { name: "", description: "", when: "", price: "" }] })}>
          <Plus aria-hidden="true" />
          {tr("Add a plan line")}
        </Button>
      </Block>

      <Block title={tr("Notes")} hint={tr("The small italic lines at the bottom. One per line.")}>
        <Textarea rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={tr("Prices are per visit.")} aria-label={tr("Notes")} />
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {tr("Sales tax added at acceptance")}
          <Input
            value={draft.taxBp ? String(draft.taxBp / 100) : ""}
            onChange={(e) => {
              const pct = Number(e.target.value);
              set({ taxBp: e.target.value.trim() === "" || !Number.isFinite(pct) ? 0 : Math.round(Math.min(20, Math.max(0, pct)) * 100) });
            }}
            inputMode="decimal"
            placeholder="0"
            aria-label={tr("Sales tax percent")}
            className="h-8 w-20 tabular-nums"
          />
          %
        </label>
      </Block>
    </div>
  );
}

// Paste a list (one per line) to add several tasks at once.
function AddSeveral({ onAdd }: { onAdd: (labels: string[]) => void }) {
  const { tr } = useI18n();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer rounded-md border px-3 py-1.5 text-[0.8rem] font-medium hover:bg-secondary">{tr("Paste a list")}</summary>
      <div className="mt-2 grid gap-2">
        <Textarea id="paste-tasks" rows={4} placeholder={tr("Baseboards\nInside the oven\nWindow sills")} aria-label={tr("Tasks, one per line")} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() => {
            const box = document.getElementById("paste-tasks") as HTMLTextAreaElement | null;
            const labels = (box?.value ?? "").split("\n").map((s) => s.replace(/^[\s•✓\-*]+/, "").trim()).filter(Boolean);
            if (labels.length) onAdd(labels);
            if (box) box.value = "";
          }}
        >
          {tr("Add them")}
        </Button>
      </div>
    </details>
  );
}

"use client";

import { startTransition, useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CleaningIcon } from "@/components/cleaning-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { cleaningIcons, type CleaningIcon as IconKey } from "@/lib/quotes/icons";
import type { Extra, PriceList } from "@/lib/quotes/pricing";
import { parseCents } from "../../invoices/money";

type Msg = { message?: string; ok?: string };

// Dollar inputs that keep what's typed and store cents.
function Dollars({ cents, onChange, label }: { cents: number; onChange: (c: number) => void; label: string }) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseCents(e.target.value);
          if (c !== null && c >= 0) onChange(c);
        }}
        inputMode="decimal"
        aria-label={label}
        className="h-8 w-28 pl-5 tabular-nums"
      />
    </div>
  );
}
const Whole = ({ value, onChange, label, w = "w-20" }: { value: number; onChange: (n: number) => void; label: string; w?: string }) => (
  <Input value={String(value)} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} inputMode="numeric" aria-label={label} className={`h-8 ${w} tabular-nums`} />
);

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-[0.8rem] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
const Remove = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
    <Trash2 aria-hidden="true" />
  </Button>
);

// Choose an extra's icon from the cleaning set.
function IconPicker({ value, onChange, label }: { value: IconKey; onChange: (k: IconKey) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${label}: ${cleaningIcons[value]}. Change icon`} className="grid size-10 place-items-center rounded-lg border bg-card hover:border-brand-green/60">
        <CleaningIcon name={value} className="size-5 text-brand-green" />
      </button>
      {open && (
        <div role="listbox" aria-label="Icons" className="absolute top-11 left-0 z-30 grid w-72 grid-cols-6 gap-1 rounded-lg border bg-popover p-2 shadow-lg">
          {(Object.keys(cleaningIcons) as IconKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={k === value}
              title={cleaningIcons[k]}
              aria-label={cleaningIcons[k]}
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
              className={cn("grid size-10 place-items-center rounded-md hover:bg-secondary", k === value && "bg-brand-green/15 ring-2 ring-brand-green")}
            >
              <CleaningIcon name={k} className="size-5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PriceForm({ action, initial }: { action: (prev: Msg, f: FormData) => Promise<Msg>; initial: PriceList }) {
  const [state, run, pending] = useActionState(action, {});
  const [l, setL] = useState<PriceList>(initial);
  const set = (patch: Partial<PriceList>) => setL({ ...l, ...patch });
  const updExtra = (i: number, patch: Partial<Extra>) => set({ extras: l.extras.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData();
        data.set("list", JSON.stringify(l));
        startTransition(() => run(data));
      }}
      className="mt-6 grid gap-5"
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Base price by bedrooms">
          <ul className="grid gap-1.5">
            {l.bedrooms.map((b, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Whole value={b.bedrooms} onChange={(n) => set({ bedrooms: l.bedrooms.map((x, j) => (j === i ? { ...x, bedrooms: n } : x)) })} label={`Bedrooms, row ${i + 1}`} w="w-14" />
                bedrooms
                <Dollars cents={b.cents} onChange={(c) => set({ bedrooms: l.bedrooms.map((x, j) => (j === i ? { ...x, cents: c } : x)) })} label={`${b.bedrooms} bedroom price`} />
                <Remove onClick={() => set({ bedrooms: l.bedrooms.filter((_, j) => j !== i) })} label={`Remove ${b.bedrooms} bedrooms`} />
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ bedrooms: [...l.bedrooms, { bedrooms: (l.bedrooms.at(-1)?.bedrooms ?? 0) + 1, cents: 0 }] })}>
            <Plus aria-hidden="true" />
            Add a row
          </Button>
        </Section>

        <Section title="Square footage" hint="Added to the bedroom price; the estimate doesn't list it separately.">
          <ul className="grid gap-1.5">
            {l.sqft.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                up to <Whole value={s.upTo} onChange={(n) => set({ sqft: l.sqft.map((x, j) => (j === i ? { ...x, upTo: n } : x)) })} label={`Square feet, row ${i + 1}`} w="w-24" /> sq ft
                <Dollars cents={s.cents} onChange={(c) => set({ sqft: l.sqft.map((x, j) => (j === i ? { ...x, cents: c } : x)) })} label={`Surcharge up to ${s.upTo} sq ft`} />
                <Remove onClick={() => set({ sqft: l.sqft.filter((_, j) => j !== i) })} label={`Remove up to ${s.upTo} sq ft`} />
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ sqft: [...l.sqft, { upTo: (l.sqft.at(-1)?.upTo ?? 0) + 500, cents: 0 }] })}>
            <Plus aria-hidden="true" />
            Add a row
          </Button>
        </Section>

        <Section title="Bathrooms">
          <div className="grid gap-2 text-sm">
            <label className="flex items-center justify-between gap-2">
              Each bathroom <Dollars cents={l.bathroomCents} onChange={(c) => set({ bathroomCents: c })} label="Each bathroom" />
            </label>
            <label className="flex items-center justify-between gap-2">
              Minimum bathrooms charged <Whole value={l.minBathrooms} onChange={(n) => set({ minBathrooms: n })} label="Minimum bathrooms" />
            </label>
            <label className="flex items-center justify-between gap-2">
              Most bathrooms <Whole value={l.maxBathrooms} onChange={(n) => set({ maxBathrooms: n })} label="Most bathrooms" />
            </label>
            <label className="flex items-center justify-between gap-2">
              Each half bath <Dollars cents={l.halfBathCents} onChange={(c) => set({ halfBathCents: c })} label="Each half bath" />
            </label>
          </div>
        </Section>

        <Section title="Recurring discounts" hint="Off the standard cleanings after the first visit.">
          <ul className="grid gap-1.5">
            {l.frequencies.map((f, i) => (
              <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                {f.name}
                <span className="flex items-center gap-1.5">
                  <Whole value={f.discountPct} onChange={(n) => set({ frequencies: l.frequencies.map((x, j) => (j === i ? { ...x, discountPct: n } : x)) })} label={`${f.name} discount`} w="w-16" />% off
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Types of cleaning" hint="Standard is the base price; Deep clean and Move-in / move-out are a flat amount on top. The tasks are the “what's included” list.">
        <div className="grid gap-3 lg:grid-cols-3">
          {l.levels.map((s, i) => (
            <div key={s.id} className="grid content-start gap-2 rounded-md border bg-secondary/20 p-3">
              <Input value={s.name} onChange={(e) => set({ levels: l.levels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={`${s.id} name`} className="h-8" />
              {s.id !== "standard" && (
                <label className="flex items-center gap-2 text-sm">
                  Adds <Dollars cents={s.upgradeCents} onChange={(c) => set({ levels: l.levels.map((x, j) => (j === i ? { ...x, upgradeCents: c } : x)) })} label={`${s.name} upgrade`} />
                </label>
              )}
              <Textarea value={s.tasks.join("\n")} onChange={(e) => set({ levels: l.levels.map((x, j) => (j === i ? { ...x, tasks: e.target.value.split("\n") } : x)) })} rows={6} aria-label={`${s.name} tasks`} className="text-sm" />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Extras" hint="Each one is a card on the quick estimate. Pick an icon, a name and a price.">
        <ul className="grid gap-2">
          {l.extras.map((x, i) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 text-sm">
              <IconPicker value={x.icon} onChange={(k) => updExtra(i, { icon: k })} label={x.name || `Extra ${i + 1}`} />
              <Input value={x.name} onChange={(e) => updExtra(i, { name: e.target.value })} aria-label={`Extra ${i + 1} name`} placeholder="Example: Inside windows" className="h-8 w-48" />
              <Dollars cents={x.priceCents} onChange={(c) => updExtra(i, { priceCents: c })} label={`${x.name || `Extra ${i + 1}`} price`} />
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={x.perUnit} onChange={(e) => updExtra(i, { perUnit: e.target.checked })} className="accent-brand-blue" />
                per
              </label>
              {x.perUnit && <Input value={x.unit} onChange={(e) => updExtra(i, { unit: e.target.value })} aria-label={`${x.name} unit`} placeholder="room" className="h-8 w-24" />}
              <Remove onClick={() => set({ extras: l.extras.filter((_, j) => j !== i) })} label={`Remove ${x.name}`} />
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ extras: [...l.extras, { id: `x${Date.now()}`, name: "", icon: "sparkles", priceCents: 0, perUnit: false, unit: "room", minUnits: 1 }] })}>
          <Plus aria-hidden="true" />
          Add an extra
        </Button>
      </Section>

      {(state.message || state.ok) && (
        <p role={state.message ? "alert" : "status"} className={state.message ? "text-sm text-destructive" : "text-sm text-brand-green"}>
          {state.message ?? state.ok}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save prices"}
        </Button>
      </div>
    </form>
  );
}

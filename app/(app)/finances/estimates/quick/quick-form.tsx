"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { ChoiceTile as Tile } from "@/components/choice-tile";
import { CleaningIcon } from "@/components/cleaning-icon";
import { FormField } from "@/components/form-field";
import { QuoteDocument } from "@/components/quote-document";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";
import { allowedFrequencies, buildEstimate, frequencyRequired, fmtCents, sqftRanges, type EstimateInput, type PriceList } from "@/lib/quotes/pricing";
import { CustomerPicker, type CustomerOption } from "../../../properties/customer-picker";

type Msg = { message?: string; errors?: Record<string, string> };
type Company = { legalName: string; address: string; phone: string; shortName: string };

const levelIcon: Record<string, string> = { standard: "sparkles", deep: "spray", moveout: "truck" };

function Stepper({ value, onChange, min = 0, max = 20, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  const { tr } = useI18n();
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <Button type="button" variant="outline" size="icon-sm" onClick={() => onChange(Math.max(min, value - 1))} aria-label={tr("Fewer {what}", { what: label.toLowerCase() })}>
        <Minus aria-hidden="true" />
      </Button>
      <span className="w-8 text-center font-medium tabular-nums">{value}</span>
      <Button type="button" variant="outline" size="icon-sm" onClick={() => onChange(Math.min(max, value + 1))} aria-label={tr("More {what}", { what: label.toLowerCase() })}>
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}

// A count in the home (bedrooms, bathrooms): a card with an icon and − / +.
function CountCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    // a row on phones, a card from small screens up
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 sm:grid sm:place-items-center sm:content-center sm:gap-1.5 sm:text-center">
      <CleaningIcon name={icon} className="size-7 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm leading-tight font-medium sm:text-[0.8rem]">{title}</span>
      {children}
    </div>
  );
}

const Legend = ({ children }: { children: React.ReactNode }) => <legend className="px-1 text-lg font-semibold">{children}</legend>;

// The only way estimates are made: the type of cleaning, the home and the
// extras, priced from the price list and laid out like the paper estimates.
export function QuickForm({
  action,
  list,
  customers,
  properties,
  company,
  number,
  initialCustomer,
}: {
  action: (prev: Msg, f: FormData) => Promise<Msg>;
  list: PriceList;
  customers: CustomerOption[];
  properties: { id: number; customerId: number; label: string }[];
  company: Company;
  number: number;
  initialCustomer: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const { tr, fmt } = useI18n();
  const money = fmt.money;
  const [customer, setCustomer] = useState<CustomerOption | null>(customers.find((c) => String(c.id) === initialCustomer) ?? null);
  const theirs = properties.filter((p) => p.customerId === customer?.id);
  const [propertyId, setPropertyId] = useState(theirs[0] ? String(theirs[0].id) : "");
  const [levels, setLevels] = useState<string[]>([]);
  const [bedrooms, setBedrooms] = useState(list.bedrooms[1]?.bedrooms ?? list.bedrooms[0]?.bedrooms ?? 1);
  const [bathrooms, setBathrooms] = useState(Math.max(1, list.minBathrooms));
  const [halfBaths, setHalfBaths] = useState(0);
  const [sqft, setSqft] = useState(String(list.sqft[0]?.upTo ?? ""));
  const [extras, setExtras] = useState<Record<string, number>>({}); // picked extras and their count
  const [frequencyId, setFrequencyId] = useState("");
  // set when "every 2 weeks" was picked automatically, until someone confirms it
  const [toConfirm, setToConfirm] = useState(false);

  const frequencies = allowedFrequencies(list, levels);
  function toggleLevel(id: string) {
    let next = levels.includes(id) ? levels.filter((x) => x !== id) : [...levels, id];
    // move-in/out and deep clean don't go together
    if (id === "moveout" && next.includes("moveout")) next = next.filter((x) => x !== "deep");
    if (id === "deep" && next.includes("deep")) next = next.filter((x) => x !== "moveout");
    setLevels(next);
    const allowed = allowedFrequencies(list, next);
    if (frequencyRequired(next) && !allowed.some((f) => f.id === frequencyId) && allowed.some((f) => f.id === "biweekly")) {
      // standard cleanings after a deep or move-in/out clean: start them on
      // every 2 weeks, to be confirmed
      setFrequencyId("biweekly");
      setToConfirm(true);
      return;
    }
    if (!frequencyRequired(next)) setToConfirm(false);
    if (!allowed.some((f) => f.id === frequencyId)) setFrequencyId("");
  }
  function chooseFrequency(id: string) {
    setFrequencyId(id);
    setToConfirm(false);
  }

  const input: EstimateInput = {
    bedrooms,
    bathrooms,
    halfBaths,
    sqft: Number(sqft) || null,
    levels,
    frequencyId: frequencyId || null,
    extras: Object.entries(extras).map(([id, units]) => ({ id, units })),
  };
  const built = buildEstimate(list, input);
  const option = built.content.options[0];
  const recurring = built.content.recurring[0];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set("input", JSON.stringify(input));
        startTransition(() => run(data));
      }}
      className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      noValidate
    >
      <div className="grid content-start gap-5">
        {(state.message || state.errors) && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.message ? tr(state.message) : Object.values(state.errors ?? {}).map((e) => tr(e)).join(" ")}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="customerId" label={tr("Customer or lead")} required className="grid content-start gap-1.5 sm:col-span-2">
            <CustomerPicker
              id="customerId"
              name="customerId"
              customers={customers}
              value={customer}
              onChange={(c) => {
                setCustomer(c);
                const first = properties.find((p) => p.customerId === c?.id);
                setPropertyId(first ? String(first.id) : "");
              }}
            />
          </FormField>
          <FormField id="propertyId" label={tr("Service address")} className="grid content-start gap-1.5 sm:col-span-2">
            <NativeSelect id="propertyId" name="propertyId" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!customer} className="w-full">
              <NativeSelectOption value="">{customer ? tr("No address") : tr("Choose who it's for first")}</NativeSelectOption>
              {theirs.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
        </div>

        <fieldset className="grid gap-3 rounded-lg border p-4">
          <Legend>{tr("Type of Cleaning")}</Legend>
          <div className="grid grid-cols-3 gap-3">
            {list.levels.map((l) => (
              <Tile
                key={l.id}
                icon={levelIcon[l.id] ?? "sparkles"}
                title={l.name}
                sub={l.upgradeCents ? `+${fmtCents(l.upgradeCents)}` : tr("Base price")}
                on={levels.includes(l.id)}
                disabled={(l.id === "deep" && levels.includes("moveout")) || (l.id === "moveout" && levels.includes("deep"))}
                onClick={() => toggleLevel(l.id)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-4 rounded-lg border p-4">
          <Legend>{tr("The Home")}</Legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <CountCard icon="bed" title={tr("Bedrooms")}>
              <Stepper
                value={bedrooms}
                onChange={(n) => {
                  // only the bedroom counts on the price list
                  const counts = list.bedrooms.map((b) => b.bedrooms);
                  const i = counts.indexOf(bedrooms);
                  setBedrooms(counts[Math.max(0, Math.min(counts.length - 1, i + (n > bedrooms ? 1 : -1)))] ?? n);
                }}
                min={list.bedrooms[0]?.bedrooms ?? 1}
                max={list.bedrooms.at(-1)?.bedrooms ?? 1}
                label={tr("Bedrooms")}
              />
            </CountCard>
            <CountCard icon="bath" title={tr("Bathrooms")}>
              <Stepper value={bathrooms} onChange={setBathrooms} min={list.minBathrooms} max={list.maxBathrooms} label={tr("Bathrooms")} />
            </CountCard>
            <CountCard icon="toilet" title={tr("Half Baths")}>
              <Stepper value={halfBaths} onChange={setHalfBaths} label={tr("Half baths")} />
            </CountCard>
          </div>
          <div className="grid gap-1.5 sm:w-80">
            <label htmlFor="sqft" className="text-sm font-medium">
              {tr("Square feet")}
            </label>
            <NativeSelect id="sqft" value={sqft} onChange={(e) => setSqft(e.target.value)} className="w-full">
              {sqftRanges(list, tr).map((r) => (
                <NativeSelectOption key={r.upTo} value={String(r.upTo)}>
                  {r.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </fieldset>

        {list.extras.length > 0 && (
          <fieldset className="grid gap-3 rounded-lg border p-4">
            <Legend>{tr("Extras")}</Legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {list.extras.map((x) => {
                const on = x.id in extras;
                return (
                  <Tile
                    key={x.id}
                    icon={x.icon}
                    title={x.name}
                    sub={x.perUnit ? tr("{price} per {unit}", { price: fmtCents(x.priceCents), unit: x.unit }) : fmtCents(x.priceCents)}
                    on={on}
                    onClick={() => {
                      const next = { ...extras };
                      if (on) delete next[x.id];
                      else next[x.id] = x.minUnits;
                      setExtras(next);
                    }}
                  >
                    {on && x.perUnit && (
                      <div className="mt-1.5 flex justify-center">
                        <Stepper value={extras[x.id]} onChange={(n) => setExtras({ ...extras, [x.id]: n })} min={x.minUnits} max={50} label={`${x.unit}s`} />
                      </div>
                    )}
                  </Tile>
                );
              })}
            </div>
          </fieldset>
        )}

        <fieldset className={cn("grid gap-3 rounded-lg border p-4 transition-shadow", toConfirm && "border-amber-500 bg-amber-500/[0.06] shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-amber-500)_25%,transparent)]")}>
          <Legend>{tr("Recurring Cleaning Frequency")}</Legend>
          {toConfirm && (
            <p role="status" className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {tr("Please confirm frequency of cleanings")}
            </p>
          )}
          {frequencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {levels.includes("moveout") ? tr("A move-in / move-out clean is one-time. Add Standard for regular cleanings after.") : tr("Pick the type of cleaning first.")}
            </p>
          ) : (
            <>
              <p className="text-[0.8rem] text-muted-foreground">
                {levels.includes("deep") && !levels.includes("standard") ? tr("The deep clean, repeated.") : tr("Standard cleanings after the first visit.")} {tr("The discount starts with the second visit.")}
              </p>
              <div role="radiogroup" aria-label={tr("Recurring Cleaning Frequency")} className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-3">
                {/* standard cleanings after a deep or move-in/out clean always repeat */}
                {!frequencyRequired(levels) && (
                  <Tile radio title={tr("None")} sub={tr("One-time")} on={!frequencyId} onClick={() => chooseFrequency("")} />
                )}
                {frequencies.map((f) => (
                  <Tile
                    key={f.id}
                    radio
                    title={f.name}
                    sub={tr("{pct}% off", { pct: f.discountPct })}
                    on={!toConfirm && frequencyId === f.id}
                    suggested={toConfirm && frequencyId === f.id}
                    onClick={() => chooseFrequency(f.id)}
                  />
                ))}
              </div>
            </>
          )}
        </fieldset>

        <input type="hidden" name="internalNotes" value="" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || Boolean(built.error) || !customer || toConfirm}>
            {pending ? tr("Creating…") : tr("Create estimate")}
          </Button>
          <Link href="/finances/estimates" className={buttonVariants({ variant: "outline" })}>
            {tr("Cancel")}
          </Link>
          <span className={cn("text-[0.8rem]", toConfirm ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            {toConfirm ? tr("Confirm the cleaning frequency first.") : tr("Saved as a draft to review before sending.")}
          </span>
        </div>
      </div>

      <div className="grid content-start gap-4">
        <section className="rounded-lg border p-4" aria-live="polite">
          <h2 className="mb-2 font-semibold">{tr("Price")}</h2>
          {built.error || !option ? (
            <p className="text-sm text-muted-foreground">{built.error && tr(built.error, built.errorVars)}</p>
          ) : (
            <div className="grid gap-1 text-sm">
              <p className="font-semibold">{option.name}</p>
              {option.description.split(" · ").map((l) => (
                <p key={l} className="flex justify-between text-muted-foreground">
                  <span>{l.replace(/ \$[\d,.]+$/, "")}</span>
                  <span className="tabular-nums">{/\$[\d,.]+$/.exec(l)?.[0]}</span>
                </p>
              ))}
              <p className="flex justify-between border-t pt-1 font-semibold">
                <span>{tr("First visit")}</span>
                <span className="tabular-nums">{money(option.priceCents)}</span>
              </p>
              {recurring && (
                <p className="flex justify-between text-muted-foreground">
                  <span>{tr("Then standard cleanings, {when}", { when: recurring.when.toLowerCase() })}</span>
                  <span className="tabular-nums">{money(recurring.priceCents)}</span>
                </p>
              )}
            </div>
          )}
        </section>
        {!built.error && option && (
          <div className="hidden rounded-lg border bg-[#eef1f5] p-3 xl:block">
            <QuoteDocument
              number={number}
              date={tr("(when sent)")}
              company={company}
              preparedFor={{ name: customer?.label.replace(/\s\(.*$/, "") ?? tr("Customer name"), address: theirs.find((p) => String(p.id) === propertyId)?.label ?? null }}
              content={built.content}
            />
          </div>
        )}
      </div>
    </form>
  );
}

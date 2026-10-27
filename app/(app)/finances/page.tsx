import Link from "next/link";
import { Suspense } from "react";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "cn";
import { getI18n } from "@/lib/i18n/server";
import { isStripeConfigured, isTestMode } from "@/lib/stripe";
import { getCustomerOptions } from "../customers/data";
import { getInvoices, PAGE_SIZE, parseFilters, statuses, type InvoiceFilters, type SortKey, type Tab } from "./data";
import { InvoiceTable } from "./invoice-table";
import { SyncButton } from "./sync-button";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

// (shown through tr())
const tabLabels: Record<Tab, string> = {
  all: "All invoices",
  to_finalize: "To finalize",
  draft: "invoices|Draft",
  open: "invoices|Open",
  past_due: "invoices|Past due",
  paid: "invoices|Paid",
};
const statusLabels = { draft: "invoice|Draft", open: "invoice|Open", paid: "invoice|Paid", void: "invoice|Void", uncollectible: "invoice|Uncollectible" };

// A "from … to …" pair of inputs.
async function Range({
  legend,
  stackOnPhone = false,
  children,
}: {
  legend: string;
  stackOnPhone?: boolean;
  children: [React.ReactNode, React.ReactNode];
}) {
  const { tr } = await getI18n();
  return (
    <fieldset className="grid min-w-0 gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      {/* date pickers can't shrink enough to share a line on phones, so
          those ranges stack there */}
      <div className={cn("flex items-center gap-2", stackOnPhone && "max-sm:flex-col max-sm:items-stretch max-sm:gap-1.5")}>
        <div className="min-w-0 flex-1">{children[0]}</div>
        <span className="shrink-0 text-sm text-muted-foreground">{tr("range|to")}</span>
        <div className="min-w-0 flex-1">{children[1]}</div>
      </div>
    </fieldset>
  );
}

// Builds a /finances link from the current filters with some changed.
function hrefWith(f: InvoiceFilters, changes: Partial<Record<keyof InvoiceFilters, string | number | null>>) {
  const params = new URLSearchParams();
  const merged = {
    tab: f.tab,
    status: f.status,
    createdFrom: f.createdFrom,
    createdTo: f.createdTo,
    dueFrom: f.dueFrom,
    dueTo: f.dueTo,
    totalMin: f.totalMin !== null ? (f.totalMin / 100).toString() : null,
    totalMax: f.totalMax !== null ? (f.totalMax / 100).toString() : null,
    sort: f.sort,
    dir: f.dir,
    page: f.page,
    ...changes,
  };
  for (const [k, v] of Object.entries(merged)) {
    if (v === null || v === "" || (k === "tab" && v === "all") || (k === "page" && v === 1)) continue;
    if (k === "sort" && v === "created" && merged.dir === "desc") continue;
    if (k === "dir" && v === "desc" && merged.sort === "created") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `/finances?${qs}` : "/finances";
}

async function Invoices({ searchParams }: Pick<PageProps<"/finances">, "searchParams">) {
  const params = await searchParams;
  const f = parseFilters(params);
  const deleted = params.deleted === "draft";
  const [{ rows, counts, lastSynced, total }, { fmt, tr }] = await Promise.all([getInvoices(f), getI18n()]);
  // the customer list is only needed to link invoices that aren't linked yet
  const user = await getCurrentUser();
  const manageStripe = can(user, "stripe.manage");
  const linkOptions = manageStripe && rows.some((r) => !r.customerId) ? await getCustomerOptions() : undefined;
  const activeFilters = [f.status, f.createdFrom || f.createdTo, f.dueFrom || f.dueTo, f.totalMin !== null || f.totalMax !== null].filter(Boolean).length;
  const range = (from: string | null, to: string | null) =>
    from && to ? `${fmt.calendarDate(from)} – ${fmt.calendarDate(to)}` : from ? tr("from {date}", { date: fmt.calendarDate(from) }) : tr("until {date}", { date: fmt.calendarDate(to!) });
  const money = (cents: number) => fmt.money(cents);
  const chips = [
    f.status && { label: tr("Status: {status}", { status: tr(statusLabels[f.status]) }), remove: hrefWith(f, { status: null, page: 1 }) },
    (f.createdFrom || f.createdTo) && {
      label: tr("Created {range}", { range: range(f.createdFrom, f.createdTo) }),
      remove: hrefWith(f, { createdFrom: null, createdTo: null, page: 1 }),
    },
    (f.dueFrom || f.dueTo) && {
      label: tr("Due {range}", { range: range(f.dueFrom, f.dueTo) }),
      remove: hrefWith(f, { dueFrom: null, dueTo: null, page: 1 }),
    },
    (f.totalMin !== null || f.totalMax !== null) && {
      label:
        f.totalMin !== null && f.totalMax !== null
          ? tr("Total {from} – {to}", { from: money(f.totalMin), to: money(f.totalMax) })
          : f.totalMin !== null
            ? tr("Total ≥ {amount}", { amount: money(f.totalMin) })
            : tr("Total ≤ {amount}", { amount: money(f.totalMax!) }),
      remove: hrefWith(f, { totalMin: null, totalMax: null, page: 1 }),
    },
  ].filter((c): c is { label: string; remove: string } => Boolean(c));
  const clearHref = hrefWith(f, { status: null, createdFrom: null, createdTo: null, dueFrom: null, dueTo: null, totalMin: null, totalMax: null, page: 1 });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (f.page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{tr("Invoices")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isTestMode() ? tr("Invoices from Stripe (sandbox)") : tr("Invoices from Stripe")} ·{" "}
            {lastSynced ? tr("last synced {time}", { time: fmt.stamp(lastSynced) }) : tr("not synced yet")}
            {counts.unlinked > 0 && ` · ${tr("{n} not linked to a customer", { n: counts.unlinked })}`}
          </p>
        </div>
        {isStripeConfigured() && (
          <div className="flex flex-wrap items-start gap-2">
            {manageStripe && <SyncButton />}
            {can(user, "invoices.create") && (
            <Link href="/finances/invoices/new" className={buttonVariants()}>
              <Plus aria-hidden="true" />
              {tr("New invoice")}
            </Link>
            )}
          </div>
        )}
      </div>
      {deleted && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {tr("Draft invoice deleted.")}
        </p>
      )}

      {/* status tabs, like Stripe's */}
      <nav aria-label={tr("Invoice status")} className="mb-4 flex gap-1 overflow-x-auto border-b">
        {(Object.keys(tabLabels) as Tab[]).map((tab) => (
          <Link
            key={tab}
            href={hrefWith(f, { tab, page: 1 })}
            aria-current={f.tab === tab ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full",
              f.tab === tab && "text-foreground after:bg-brand-green",
            )}
          >
            {tr(tabLabels[tab])}
            <span className="rounded-full bg-muted px-1.5 text-[0.75rem] tabular-nums">{counts[tab]}</span>
          </Link>
        ))}
      </nav>

      <details open={activeFilters > 0} className="mb-4 rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
          {tr("Filters")}
          {/* active filters as chips; × removes one */}
          {chips.map((chip) => (
            <Link
              key={chip.label}
              href={chip.remove}
              className="inline-flex items-center gap-1 rounded-md border bg-secondary/60 py-0.5 pr-1.5 pl-2.5 text-[0.8rem] font-normal text-secondary-foreground hover:bg-secondary"
              aria-label={tr("Remove filter: {name}", { name: chip.label })}
            >
              {chip.label}
              <X className="size-3.5" aria-hidden="true" />
            </Link>
          ))}
        </summary>
        {/* a plain GET form: filters live in the URL, so they can be bookmarked */}
        <form
          method="get"
          action="/finances"
          className="border-t"
          // remount when the filters change (a chip removed, Clear all), so the
          // fields show the current filters instead of what was typed before
          key={clearHref + chips.map((c) => c.label).join("|")}
        >
          {f.tab !== "all" && <input type="hidden" name="tab" value={f.tab} />}
          <input type="hidden" name="sort" value={f.sort} />
          <input type="hidden" name="dir" value={f.dir} />
          <div className="grid gap-x-8 gap-y-5 p-4 md:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="status">{tr("Status")}</Label>
              <NativeSelect id="status" name="status" defaultValue={f.status ?? ""} className="w-full">
                <NativeSelectOption value="">{tr("Any status")}</NativeSelectOption>
                {statuses.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {tr(statusLabels[s])}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Range legend={tr("Total ($)")}>
              <Input name="totalMin" inputMode="decimal" placeholder={tr("Min")} aria-label={tr("Total at least")} defaultValue={f.totalMin !== null ? f.totalMin / 100 : ""} />
              <Input name="totalMax" inputMode="decimal" placeholder={tr("Max")} aria-label={tr("Total at most")} defaultValue={f.totalMax !== null ? f.totalMax / 100 : ""} />
            </Range>
            <Range legend={tr("Created")} stackOnPhone>
              <Input type="date" name="createdFrom" aria-label={tr("Created from")} defaultValue={f.createdFrom ?? ""} />
              <Input type="date" name="createdTo" aria-label={tr("Created to")} defaultValue={f.createdTo ?? ""} />
            </Range>
            <Range legend={tr("Due date")} stackOnPhone>
              <Input type="date" name="dueFrom" aria-label={tr("Due from")} defaultValue={f.dueFrom ?? ""} />
              <Input type="date" name="dueTo" aria-label={tr("Due to")} defaultValue={f.dueTo ?? ""} />
            </Range>
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-3">
            <Link href={clearHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {tr("Clear all")}
            </Link>
            <button type="submit" className={buttonVariants({ size: "sm" })}>
              {tr("Apply filters")}
            </button>
          </div>
        </form>
      </details>

      <InvoiceTable
        rows={rows}
        fmt={fmt}
        linkOptions={linkOptions}
        sort={f.sort}
        dir={f.dir}
        sortHref={(k: SortKey) => hrefWith(f, { sort: k, dir: f.sort === k && f.dir === "desc" ? "asc" : "desc", page: 1 })}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {total === 0 ? tr("No invoices") : tr("Showing {from}–{to} of {total}", { from: first, to: first + rows.length - 1, total })}
        </span>
        {pages > 1 && (
          <div className="flex gap-2">
            {f.page > 1 && (
              <Link href={hrefWith(f, { page: f.page - 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {tr("Previous")}
              </Link>
            )}
            {f.page < pages && (
              <Link href={hrefWith(f, { page: f.page + 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {tr("Next")}
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function FinancesPage(props: PageProps<"/finances">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Invoices searchParams={props.searchParams} />
    </Suspense>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import { Eye, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { priceRange } from "@/lib/quotes/content";
import { localDay, quoteState, type QuoteState } from "@/lib/quotes/status";
import { getI18n } from "@/lib/i18n/server";
import type { Tr } from "@/lib/i18n/tr";
import { today } from "@/lib/today";
import { deleteDraftQuote } from "./actions";
import { getQuotes } from "./data";

// The filters, as pills. Withdrawn only shows when there are some.
// (labels shown through tr())
const filters = {
  all: "estimates|All",
  draft: "estimates|Draft",
  sent: "estimates|Sent",
  accepted: "estimates|Accepted",
  scheduled: "estimates|Scheduled",
  declined: "estimates|Declined",
  expired: "estimates|Expired",
  withdrawn: "estimates|Withdrawn",
} as const;
type Filter = keyof typeof filters;
const inFilter: Record<Filter, (s: QuoteState) => boolean> = {
  all: () => true,
  draft: (s) => s === "draft",
  sent: (s) => s === "sent" || s === "viewed",
  accepted: (s) => s === "accepted",
  scheduled: (s) => s === "scheduled",
  declined: (s) => s === "declined",
  expired: (s) => s === "expired",
  withdrawn: (s) => s === "withdrawn",
};
// older links (?tab=open, toschedule…) still land somewhere sensible
const oldTabs: Record<string, Filter> = { open: "sent", toschedule: "accepted", won: "accepted", lost: "declined" };

// a small status pill: blue while it's with the customer, green once accepted
const statusPill: Record<QuoteState, { label: string; className: string }> = {
  draft: { label: "estimate|Draft", className: "bg-muted text-muted-foreground" },
  sent: { label: "estimate|Sent", className: "bg-brand-blue/10 text-brand-blue" },
  viewed: { label: "estimate|Viewed", className: "bg-brand-blue/10 text-brand-blue" },
  accepted: { label: "estimate|Accepted", className: "bg-brand-green/15 text-brand-green" },
  scheduled: { label: "estimate|Scheduled", className: "bg-brand-green text-white" },
  declined: { label: "estimate|Declined", className: "bg-destructive/10 text-destructive" },
  expired: { label: "estimate|Expired", className: "bg-muted text-muted-foreground" },
  withdrawn: { label: "estimate|Withdrawn", className: "bg-muted text-muted-foreground" },
};
const Pill = ({ state, tr }: { state: QuoteState; tr: Tr }) => (
  <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[0.75rem] font-medium whitespace-nowrap", statusPill[state].className)}>{tr(statusPill[state].label)}</span>
);

async function Estimates({ searchParams }: Pick<PageProps<"/finances/estimates">, "searchParams">) {
  const [sp, user, day, { fmt, tr }] = await Promise.all([searchParams, getCurrentUser(), today(), getI18n()]);
  const raw = typeof sp.tab === "string" ? sp.tab : "all";
  const filter: Filter = raw in filters ? (raw as Filter) : (oldTabs[raw] ?? "all");
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const manage = can(user, "quotes.manage");
  const everything = (await getQuotes()).map((x) => ({ ...x, state: quoteState(x, day) }));
  // the search narrows every filter (and their counts)
  const needle = q.toLowerCase();
  const all = needle ? everything.filter((x) => [x.customerName, x.customerCode, String(x.quoteNumber), x.content.title].some((v) => v?.toLowerCase().includes(needle))) : everything;
  const counts = Object.fromEntries((Object.keys(filters) as Filter[]).map((f) => [f, all.filter((x) => inFilter[f](x.state)).length])) as Record<Filter, number>;
  const list = all.filter((x) => inFilter[filter](x.state));
  const total = (x: (typeof list)[number]) => {
    if (x.acceptance) return fmt.money(x.acceptance.totalCents);
    const r = priceRange(x.content);
    return r.low === r.high ? fmt.money(r.low) : `${fmt.money(r.low)}–${fmt.money(r.high)}`;
  };
  const href = (f: Filter) => {
    const p = new URLSearchParams({ ...(f !== "all" ? { tab: f } : {}), ...(q ? { q } : {}) }).toString();
    return `/finances/estimates${p ? `?${p}` : ""}`;
  };
  const shown = (Object.keys(filters) as Filter[]).filter((f) => f !== "withdrawn" || counts.withdrawn > 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {sp.deleted === "1" && (
        <p role="status" className="rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {tr("Draft deleted.")}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{tr("Estimates")}</h1>
        {manage && (
          <Link href="/finances/estimates/quick" className={buttonVariants()}>
            <Plus aria-hidden="true" />
            {tr("New estimate")}
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form action="/finances/estimates" className="relative w-full lg:w-72" role="search">
          {filter !== "all" && <input type="hidden" name="tab" value={filter} />}
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={tr("Search estimates…")}
            aria-label={tr("Search estimates")}
            className="h-10 w-full rounded-lg border bg-card pr-3 pl-9 text-sm shadow-xs outline-none focus-visible:border-brand-blue focus-visible:ring-3 focus-visible:ring-brand-blue/20"
          />
        </form>
        {/* the filters scroll sideways on a phone */}
        <nav aria-label={tr("Estimate filters")} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:pb-0">
          {shown.map((f) => {
            const on = filter === f;
            return (
              <Link
                key={f}
                href={href(f)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
                  on ? "border-brand-blue bg-brand-blue text-white shadow-sm" : "bg-card text-muted-foreground hover:border-brand-blue/40 hover:bg-brand-blue/5 hover:text-foreground",
                )}
              >
                {tr(filters[f])}
                {f !== "all" && counts[f] > 0 && (
                  <span className={cn("rounded-full px-1.5 text-[0.75rem] tabular-nums", on ? "bg-white/25 text-white" : "bg-muted text-foreground")}>{counts[f]}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {q ? tr("No estimates match “{q}”.", { q }) : everything.length ? tr("None here.") : tr("No estimates yet. Make one from your price list with New estimate.")}
        </p>
      ) : (
        <>
          {/* phones: a compact list, each row opening the estimate */}
          <ul className="divide-y overflow-hidden rounded-xl border bg-card sm:hidden">
            {list.map((x) => (
              <li key={x.id}>
                <Link href={`/finances/estimates/${x.id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/70 active:bg-secondary">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{x.customerName}</span>
                      {x.customerStatus === "lead" && <Badge variant="info">{tr("customer|Lead")}</Badge>}
                    </span>
                    <span className="block text-[0.8rem] text-muted-foreground">#{x.quoteNumber}</span>
                  </span>
                  <span className="grid shrink-0 justify-items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums">{total(x)}</span>
                    <Pill state={x.state} tr={tr} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border bg-card sm:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-[0.72rem] font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-5 py-3">{tr("Estimate")}</th>
                  <th className="px-5 py-3">{tr("Customer")}</th>
                  <th className="px-5 py-3">{tr("Status")}</th>
                  <th className="px-5 py-3 text-right">{tr("Total")}</th>
                  <th className="px-5 py-3">{tr("Date")}</th>
                  <th className="px-5 py-3 text-right">{tr("Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((x) => (
                  <tr key={x.id} className="relative transition-colors hover:bg-secondary/60">
                    <td className="px-5 py-3">
                      {/* stretches over the row so the whole row opens it */}
                      <Link href={`/finances/estimates/${x.id}`} className="font-semibold text-foreground after:absolute after:inset-0">
                        #{x.quoteNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      {x.customerName}
                      {x.customerStatus === "lead" && <Badge variant="info" className="ml-2">{tr("customer|Lead")}</Badge>}
                    </td>
                    <td className="px-5 py-3">
                      <Pill state={x.state} tr={tr} />
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">{total(x)}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{fmt.calendarDate(localDay(x.sentAt ?? x.createdAt))}</td>
                    <td className="px-5 py-3">
                      <span className="relative z-10 flex items-center justify-end gap-0.5">
                        <Link href={`/finances/estimates/${x.id}`} aria-label={tr("View estimate #{n}", { n: x.quoteNumber })} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                          <Eye aria-hidden="true" />
                        </Link>
                        {manage && x.status !== "accepted" && (
                          <Link href={`/finances/estimates/${x.id}/edit`} aria-label={tr("Edit estimate #{n}", { n: x.quoteNumber })} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                            <Pencil aria-hidden="true" />
                          </Link>
                        )}
                        {manage && x.status === "draft" && !x.sentAt && (
                          <ConfirmButton
                            label={tr("Delete estimate #{n}", { n: x.quoteNumber })}
                            icon={<Trash2 aria-hidden="true" />}
                            variant="ghost"
                            size="icon-sm"
                            title={tr("Delete this draft?")}
                            description={tr("It was never sent, so it's removed for good.")}
                            confirmLabel={tr("Delete draft")}
                            action={deleteDraftQuote.bind(null, x.id)}
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function EstimatesPage(props: PageProps<"/finances/estimates">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Estimates searchParams={props.searchParams} />
    </Suspense>
  );
}

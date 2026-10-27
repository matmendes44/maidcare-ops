import Link from "next/link";
import { Suspense } from "react";
import { Download, FileSpreadsheet, Plus, Printer, Repeat } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { today } from "@/lib/today";
import { NoAccess } from "../no-access";
import { parseExpenseFilters } from "./data";
import { exportQuery } from "./export-query";
import { ExpenseList } from "./list";
import { Overview } from "./overview";
import { Recurring } from "./recurring";
import { getI18n } from "@/lib/i18n/server";
import { phrase } from "@/lib/i18n/tr";

// (shown through tr())
const tabs = { overview: phrase("Overview"), list: phrase("All expenses"), recurring: phrase("expenses|Recurring") } as const;
type Tab = keyof typeof tabs;

const notices: Record<string, string> = { schedule: phrase("Recurring expense saved.") };

async function Expenses({ searchParams }: Pick<PageProps<"/finances/expenses">, "searchParams">) {
  const { tr } = await getI18n();
  const user = await getCurrentUser();
  if (!can(user, "expenses.view")) return <NoAccess what="expenses" />;
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const manage = can(user, "expenses.manage");
  // recurring expenses are the owner's: staff only add one-time ones
  const shownTabs = (Object.keys(tabs) as Tab[]).filter((t) => manage || t !== "recurring");
  const tab: Tab = shownTabs.includes(one("tab") as Tab) ? (one("tab") as Tab) : "overview";
  const day = await today();
  const range = resolveRange({ range: one("range") ?? "ytd", from: one("from"), to: one("to") }, day);
  const filters = parseExpenseFilters(params);
  // exports cover what's on screen: the list's filters, or the overview's period
  const scope = tab === "list" ? exportQuery(filters) : `from=${range.from}&to=${range.to}`;

  return (
    <>
      {one("deleted") === "1" && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {tr("Expense deleted.")}
        </p>
      )}
      {one("saved") && notices[one("saved")!] && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {tr(notices[one("saved")!])}
        </p>
      )}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{tr("Expenses")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tr("What the business spends, with receipts, recurring bills and what's expected.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <details className="relative">
            <summary className={cn(buttonVariants({ variant: "outline" }), "list-none [&::-webkit-details-marker]:hidden")}>
              <Download aria-hidden="true" />
              {tr("Export")}
            </summary>
            <div className="absolute right-0 z-30 mt-1 grid w-60 gap-0.5 rounded-lg border bg-popover p-1.5 text-sm shadow-lg">
              <a href={`/api/expenses/export?format=csv&${scope}`} className="flex items-center gap-2 rounded-md px-2.5 py-2 hover:bg-secondary">
                <Download className="size-4 text-muted-foreground" aria-hidden="true" />
                {tr("CSV (any spreadsheet)")}
              </a>
              <a href={`/api/expenses/export?format=xlsx&${scope}`} className="flex items-center gap-2 rounded-md px-2.5 py-2 hover:bg-secondary">
                <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden="true" />
                {tr("Excel, with a summary sheet")}
              </a>
              <Link href={`/finances/expenses/report?${scope}`} className="flex items-center gap-2 rounded-md px-2.5 py-2 hover:bg-secondary">
                <Printer className="size-4 text-muted-foreground" aria-hidden="true" />
                {tr("PDF report (print or save)")}
              </Link>
              <p className="px-2.5 pt-1 pb-0.5 text-[0.75rem] text-muted-foreground">
                {tab === "list" ? tr("Uses the list's filters.") : tr("Covers {from} to {to}.", { from: range.from, to: range.to })}{" "}
                {tr("Categories include the Schedule C line for your accountant.")}
              </p>
            </div>
          </details>
          {manage && (
            <Link href="/finances/expenses/recurring/new" className={buttonVariants({ variant: "outline" })}>
              <Repeat aria-hidden="true" />
              {tr("Recurring")}
            </Link>
          )}
          {can(user, "expenses.create") && (
            <Link href="/finances/expenses/new" className={buttonVariants()}>
              <Plus aria-hidden="true" />
              {tr("New expense")}
            </Link>
          )}
        </div>
      </div>

      <nav aria-label={tr("Expense views")} className="mb-6 flex gap-1 overflow-x-auto border-b">
        {shownTabs.map((t) => (
          <Link
            key={t}
            href={t === "overview" ? "/finances/expenses" : `/finances/expenses?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full",
              tab === t && "text-foreground after:bg-brand-green",
            )}
          >
            {tr(tabs[t])}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview range={range} today={day} trend={one("trend")} showIncome={can(user, "reports.view")} manage={manage} />}
      {tab === "list" && <ExpenseList filters={filters} />}
      {tab === "recurring" && <Recurring today={day} manage={manage} />}
    </>
  );
}

export default function ExpensesPage(props: PageProps<"/finances/expenses">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Expenses searchParams={props.searchParams} />
    </Suspense>
  );
}

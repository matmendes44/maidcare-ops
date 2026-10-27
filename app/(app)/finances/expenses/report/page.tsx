import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { categories, paidWith, type Category } from "@/lib/expenses/options";
import { getI18n } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/tr";
import { today } from "@/lib/today";
import { NoAccess } from "../../no-access";
import { getExpenses, parseExpenseFilters } from "../data";
import { exportQuery } from "../export-query";
import { PrintButton } from "./print-button";

// A printable expense report (the browser's "Save as PDF" makes the PDF):
// totals by category with Schedule C lines, by month, and every expense.
async function Report({ searchParams }: Pick<PageProps<"/finances/expenses/report">, "searchParams">) {
  const user = await getCurrentUser();
  if (!can(user, "expenses.view")) return <NoAccess what="expenses" />;
  const filters = { ...parseExpenseFilters(await searchParams), sort: "date" as const, dir: "asc" as const, page: 1 };
  const [{ rows, sum }, { fmt, tr }, day] = await Promise.all([getExpenses(filters, { all: true }), getI18n(), today()]);

  const totals = new Map<string, { cents: number; count: number }>();
  const months = new Map<string, number>();
  for (const r of rows) {
    const t = totals.get(r.expense.category) ?? { cents: 0, count: 0 };
    t.cents += r.expense.amountCents;
    t.count++;
    totals.set(r.expense.category, t);
    const m = r.expense.expenseDate.slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + r.expense.amountCents);
  }
  const missing = rows.filter((r) => r.receipts === 0).length;
  const back = `/finances/expenses?tab=list${exportQuery(filters) ? `&${exportQuery(filters)}` : ""}`;
  const period = tr("{from} to {to}", { from: filters.from ? fmt.calendarDate(filters.from) : tr("the beginning"), to: filters.to ? fmt.calendarDate(filters.to) : fmt.calendarDate(day) });
  const cell = "border-b px-2 py-1.5";

  return (
    <article className="mx-auto max-w-4xl text-[0.9rem] print:max-w-none print:text-[10pt]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {tr("Expenses")}
        </Link>
        <PrintButton />
      </div>
      <header className="mb-6 border-b pb-4">
        <p className="text-[0.8rem] font-semibold tracking-wide text-muted-foreground uppercase">MaidCare Cleaning Service</p>
        <h1 className="mt-1 text-2xl font-bold">{tr("Expense report")}</h1>
        <p className="mt-1 text-muted-foreground">
          {period} · {plural(tr, rows.length, "{n} expense", "{n} expenses")} · {tr("total")} <span className="font-semibold text-foreground">{fmt.money(sum)}</span>
          {missing > 0 && ` · ${tr("{n} without a receipt", { n: missing })}`}
        </p>
        <p className="mt-1 text-[0.8rem] text-muted-foreground">{tr("Prepared {date} by {name}.", { date: fmt.calendarDate(day), name: user!.name })}</p>
      </header>

      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-2 text-lg font-semibold">{tr("By category")}</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-[0.8rem] text-muted-foreground">
              <th className={cell}>{tr("Category")}</th>
              <th className={cell}>{tr("Schedule C line")}</th>
              <th className={`${cell} text-right`}>{tr("Expenses")}</th>
              <th className={`${cell} text-right`}>{tr("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {[...totals.entries()]
              .sort((a, b) => b[1].cents - a[1].cents)
              .map(([k, t]) => (
                <tr key={k}>
                  <td className={cell}>{categories[k as Category]?.label ?? k}</td>
                  <td className={`${cell} text-muted-foreground`}>{categories[k as Category]?.scheduleC}</td>
                  <td className={`${cell} text-right tabular-nums`}>{t.count}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmt.money(t.cents)}</td>
                </tr>
              ))}
            <tr className="font-semibold">
              <td className="px-2 py-1.5" colSpan={2}>
                {tr("Total")}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rows.length}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt.money(sum)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">{tr("Schedule C lines are suggested from the category; check with your accountant.")}</p>
      </section>

      {months.size > 1 && (
        <section className="mb-8 break-inside-avoid">
          <h2 className="mb-2 text-lg font-semibold">{tr("By month")}</h2>
          <table className="w-full max-w-sm border-collapse text-left">
            <tbody>
              {[...months.entries()].map(([m, cents]) => (
                <tr key={m}>
                  <td className={cell}>{new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmt.money(cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">{tr("Every expense")}</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-[0.8rem] text-muted-foreground">
              <th className={cell}>{tr("Date")}</th>
              <th className={cell}>{tr("Vendor")}</th>
              <th className={cell}>{tr("Category")}</th>
              <th className={cell}>{tr("Description")}</th>
              <th className={cell}>{tr("Paid with")}</th>
              <th className={`${cell} text-right`}>{tr("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ expense: e, vendorName, receipts }) => (
              <tr key={e.id} className="break-inside-avoid align-top">
                <td className={`${cell} whitespace-nowrap tabular-nums`}>{e.expenseDate}</td>
                <td className={cell}>{vendorName}</td>
                <td className={cell}>{categories[e.category as Category]?.label ?? e.category}</td>
                <td className={`${cell} text-muted-foreground`}>
                  {e.description}
                  {receipts === 0 && <span className="ml-1 text-[0.75rem] text-amber-700">{tr("(no receipt)")}</span>}
                </td>
                <td className={`${cell} whitespace-nowrap`}>{paidWith(e)}</td>
                <td className={`${cell} text-right tabular-nums`}>{fmt.money(e.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </article>
  );
}

export default function ReportPage(props: PageProps<"/finances/expenses/report">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Report searchParams={props.searchParams} />
    </Suspense>
  );
}

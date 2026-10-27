import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Paperclip, Repeat } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel, frequencies, paidWith } from "@/lib/expenses/options";
import type { Formatters } from "@/lib/i18n/format";
import type { ExpenseRow, ExpenseSort } from "./data";
import { getI18n } from "@/lib/i18n/server";

// Expenses as a table; clicking a row opens the expense. With `sortHref`,
// the Date, Vendor, Category and Total headers sort.
export async function ExpenseTable({
  rows,
  fmt,
  sort,
  dir,
  sortHref,
  hideVendor = false,
  empty,
}: {
  rows: ExpenseRow[];
  fmt: Formatters;
  sort?: ExpenseSort;
  dir?: "asc" | "desc";
  sortHref?: (k: ExpenseSort) => string;
  hideVendor?: boolean;
  empty?: string;
}) {
  const { tr } = await getI18n();
  const head = (k: ExpenseSort | null, label: string, right = false) => {
    if (!k || !sortHref) return <TableHead className={right ? "text-right" : undefined}>{label}</TableHead>;
    const active = sort === k;
    const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={right ? "text-right" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={sortHref(k)} scroll={false} className="inline-flex items-center gap-1 hover:text-foreground">
          {label}
          <Icon className={active ? "size-3.5" : "size-3.5 text-muted-foreground/50"} aria-hidden="true" />
        </Link>
      </TableHead>
    );
  };
  const columns = hideVendor ? 5 : 6;
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table stack>
        <TableHeader>
          <TableRow>
            {head("date", tr("Date"))}
            {!hideVendor && head("vendor", tr("Vendor"))}
            {head("category", tr("Category"))}
            {head(null, tr("Paid with"))}
            {head(null, tr("Receipt"))}
            {head("amount", tr("Total"), true)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">
                {empty ?? tr("No expenses match.")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map(({ expense: e, vendorCode, vendorName, receipts, frequency }) => (
              <TableRow key={e.id} className="relative cursor-pointer">
                <TableCell data-label={tr("Date")} className="whitespace-nowrap tabular-nums">
                  {fmt.calendarDate(e.expenseDate)}
                </TableCell>
                {!hideVendor && (
                  <TableCell data-primary>
                    <Link
                      href={`/finances/expenses/${e.id}`}
                      className="font-semibold text-foreground after:absolute after:inset-0 hover:text-link focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                    >
                      {vendorName}
                    </Link>
                    <span className="ml-1.5 font-mono text-[0.75rem] text-muted-foreground">{vendorCode}</span>
                    {e.description && <div className="max-w-sm truncate text-[0.8rem] text-muted-foreground">{e.description}</div>}
                  </TableCell>
                )}
                <TableCell data-label={tr("Category")} data-primary={hideVendor || undefined}>
                  {hideVendor ? (
                    <Link href={`/finances/expenses/${e.id}`} className="text-foreground after:absolute after:inset-0 hover:text-link">
                      {tr(categoryLabel(e.category))}
                    </Link>
                  ) : (
                    tr(categoryLabel(e.category))
                  )}
                  {frequency && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[0.75rem] text-muted-foreground" title={tr("Recurring, {how}", { how: tr(frequencies[frequency]).toLowerCase() })}>
                      <Repeat className="size-3" aria-hidden="true" />
                      <span className="sr-only">{tr("Recurring")}</span>
                    </span>
                  )}
                </TableCell>
                <TableCell data-label={tr("Paid with")} className="text-muted-foreground">
                  {paidWith(e, tr)}
                </TableCell>
                <TableCell data-label={tr("Receipt")}>
                  {receipts > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[0.85rem]">
                      <Paperclip className="size-3.5" aria-hidden="true" />
                      {receipts}
                    </span>
                  ) : (
                    <span className="text-[0.8rem] text-amber-700 dark:text-amber-400">{tr("Missing")}</span>
                  )}
                </TableCell>
                <TableCell data-label={tr("Total")} className="text-right font-medium tabular-nums">
                  {fmt.money(e.amountCents)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

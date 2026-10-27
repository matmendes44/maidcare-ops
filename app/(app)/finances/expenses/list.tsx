import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { categories, categoryKeys, paymentMethodKeys, paymentMethods } from "@/lib/expenses/options";
import { getI18n } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/tr";
import { getVendorOptions } from "../vendors/data";
import { getExpenses, PAGE_SIZE, type ExpenseFilters } from "./data";
import { ExpenseTable } from "./expense-table";
import { exportQuery } from "./export-query";

export async function ExpenseList({ filters: f }: { filters: ExpenseFilters }) {
  const [{ rows, total, sum }, vendors, { fmt, tr }] = await Promise.all([getExpenses(f), getVendorOptions(), getI18n()]);
  const href = (extra: Record<string, string | number | null>) => {
    const qs = exportQuery(f, { sort: f.sort, dir: f.dir, page: f.page > 1 ? f.page : null, ...extra });
    return `/finances/expenses?tab=list${qs ? `&${qs}` : ""}`;
  };
  const active = [f.q, f.category, f.method, f.vendor, f.from, f.to, f.recurring, f.receipt].filter(Boolean).length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (f.page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <details open={active > 0} className="mb-4 rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
          {tr("Filters")}
          {active > 0 && <span className="rounded-full bg-brand-blue/10 px-2 text-[0.75rem] text-brand-blue">{tr("{n} on", { n: active })}</span>}
        </summary>
        <form method="get" action="/finances/expenses" className="border-t" key={JSON.stringify(f)}>
          <input type="hidden" name="tab" value="list" />
          <input type="hidden" name="sort" value={f.sort} />
          <input type="hidden" name="dir" value={f.dir} />
          <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid content-start gap-1.5 sm:col-span-2">
              <Label htmlFor="q">{tr("Search")}</Label>
              <Input id="q" name="q" defaultValue={f.q} placeholder={tr("Vendor, description, check number or amount")} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="from">{tr("From")}</Label>
              <Input id="from" name="from" type="date" defaultValue={f.from ?? ""} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="to">{tr("To")}</Label>
              <Input id="to" name="to" type="date" defaultValue={f.to ?? ""} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="vendor">{tr("Vendor")}</Label>
              <NativeSelect id="vendor" name="vendor" defaultValue={f.vendor ?? ""} className="w-full">
                <NativeSelectOption value="">{tr("Any vendor")}</NativeSelectOption>
                {vendors.map((v) => (
                  <NativeSelectOption key={v.id} value={v.id}>
                    {v.code} {v.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="category">{tr("Category")}</Label>
              <NativeSelect id="category" name="category" defaultValue={f.category ?? ""} className="w-full">
                <NativeSelectOption value="">{tr("Any category")}</NativeSelectOption>
                {categoryKeys.map((c) => (
                  <NativeSelectOption key={c} value={c}>
                    {tr(categories[c].label)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="method">{tr("Paid with")}</Label>
              <NativeSelect id="method" name="method" defaultValue={f.method ?? ""} className="w-full">
                <NativeSelectOption value="">{tr("Any method")}</NativeSelectOption>
                {paymentMethodKeys.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {tr(paymentMethods[m])}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="recurring">{tr("Recurring")}</Label>
                <NativeSelect id="recurring" name="recurring" defaultValue={f.recurring ?? ""} className="w-full">
                  <NativeSelectOption value="">{tr("Either")}</NativeSelectOption>
                  <NativeSelectOption value="yes">{tr("Recurring")}</NativeSelectOption>
                  <NativeSelectOption value="no">{tr("One-time")}</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="receipt">{tr("Receipt")}</Label>
                <NativeSelect id="receipt" name="receipt" defaultValue={f.receipt ?? ""} className="w-full">
                  <NativeSelectOption value="">{tr("Either")}</NativeSelectOption>
                  <NativeSelectOption value="missing">{tr("Missing")}</NativeSelectOption>
                  <NativeSelectOption value="has">{tr("Attached")}</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-3">
            <Link href="/finances/expenses?tab=list" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {tr("Clear all")}
            </Link>
            <button type="submit" className={buttonVariants({ size: "sm" })}>
              {tr("Apply filters")}
            </button>
          </div>
        </form>
      </details>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground" aria-live="polite">
          {active > 0 ? plural(tr, total, "{n} expense matches", "{n} expenses match") : plural(tr, total, "{n} expense", "{n} expenses")}
        </span>
        <span>
          {tr("Total")} <span className="font-semibold tabular-nums">{fmt.money(sum)}</span>
        </span>
      </div>
      <ExpenseTable
        rows={rows}
        fmt={fmt}
        sort={f.sort}
        dir={f.dir}
        sortHref={(k) => href({ sort: k, dir: f.sort === k && f.dir === "desc" ? "asc" : f.sort === k ? "desc" : k === "vendor" || k === "category" ? "asc" : "desc", page: null })}
        empty={active > 0 ? tr("No expenses match these filters.") : tr("No expenses yet.")}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{total === 0 ? "" : tr("Showing {from}–{to} of {total}", { from: first, to: first + rows.length - 1, total })}</span>
        {pages > 1 && (
          <div className="flex gap-2">
            {f.page > 1 && (
              <Link href={href({ page: f.page - 1 > 1 ? f.page - 1 : null })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {tr("Previous")}
              </Link>
            )}
            {f.page < pages && (
              <Link href={href({ page: f.page + 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {tr("Next")}
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}

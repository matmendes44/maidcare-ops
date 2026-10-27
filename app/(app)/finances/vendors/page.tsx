import Link from "next/link";
import { Suspense } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/expenses/options";
import { getI18n } from "@/lib/i18n/server";
import { SearchBox, SearchBoxFallback } from "../../customers/search-box";
import { NoAccess } from "../no-access";
import { getVendors, parseVendorParams, vendorSorts, type VendorSort } from "./data";

const columns: { key: VendorSort; label: string; right?: boolean }[] = [
  { key: "code", label: "ID" },
  { key: "name", label: "Vendor" },
  { key: "category", label: "Usual category" },
  { key: "year", label: "Spent this year", right: true },
  { key: "total", label: "All time", right: true },
  { key: "last", label: "Last expense" },
];

async function Vendors({ searchParams }: Pick<PageProps<"/finances/vendors">, "searchParams">) {
  const user = await getCurrentUser();
  if (!can(user, "vendors.view")) return <NoAccess what="vendors" />;
  const params = await searchParams;
  const p = parseVendorParams(params);
  const [{ rows, inactiveCount }, { fmt }] = await Promise.all([getVendors(p), getI18n()]);
  const href = (changes: Record<string, string | null>) => {
    const qs = new URLSearchParams();
    const merged = { sort: p.sort, dir: p.dir, q: p.q || null, inactive: p.inactive ? "1" : null, ...changes };
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    return `/finances/vendors?${qs}`;
  };

  return (
    <>
      {params.deleted === "1" && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          Vendor deleted.
        </p>
      )}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Vendors</h1>
          <p className="mt-1 text-sm text-muted-foreground">Stores, suppliers and people the business pays.</p>
        </div>
        {can(user, "expenses.manage") && (
          <Link href="/finances/vendors/new" className={buttonVariants()}>
            <Plus aria-hidden="true" />
            Add vendor
          </Link>
        )}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <Suspense fallback={<SearchBoxFallback label="Search vendors" />}>
            <SearchBox label="Search vendors" placeholder="Search ID, name, contact, account number, phone…" />
          </Suspense>
        </div>
        {inactiveCount > 0 && (
          <Link href={href({ inactive: p.inactive ? null : "1" })} className="text-sm text-link underline-offset-4 hover:underline">
            {p.inactive ? "Hide inactive" : `Show ${inactiveCount} inactive`}
          </Link>
        )}
      </div>
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {rows.length} {rows.length === 1 ? "vendor" : "vendors"}
        {p.q ? ` matching “${p.q}”` : ""}
      </p>
      <div className="overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = p.sort === c.key;
                const Icon = !active ? ArrowUpDown : p.dir === "asc" ? ArrowUp : ArrowDown;
                const nextDir = active ? (p.dir === "asc" ? "desc" : "asc") : vendorSorts[c.key].defaultDir;
                return (
                  <TableHead key={c.key} className={c.right ? "text-right" : undefined} aria-sort={active ? (p.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <Link href={href({ sort: c.key, dir: nextDir })} scroll={false} className="inline-flex items-center gap-1 hover:text-foreground">
                      {c.label}
                      <Icon className={active ? "size-3.5" : "size-3.5 text-muted-foreground/50"} aria-hidden="true" />
                    </Link>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10 text-center text-muted-foreground">
                  {p.q ? "No vendors match that search." : "No vendors yet. They're added here or while recording an expense."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ vendor: v, spentYear, spentTotal, lastExpense }) => (
                <TableRow key={v.id} className="relative cursor-pointer">
                  <TableCell data-label="ID" className="font-mono text-[0.8rem] text-muted-foreground">
                    {v.vendorCode}
                  </TableCell>
                  <TableCell data-primary>
                    <Link
                      href={`/finances/vendors/${v.id}`}
                      className="font-semibold text-foreground after:absolute after:inset-0 hover:text-link focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                    >
                      {v.name}
                    </Link>
                    {!v.isActive && (
                      <Badge variant="muted" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                    {v.contactName && <div className="text-[0.8rem] text-muted-foreground">{v.contactName}</div>}
                  </TableCell>
                  <TableCell data-label="Usual category">{v.defaultCategory ? categoryLabel(v.defaultCategory) : "—"}</TableCell>
                  <TableCell data-label="Spent this year" className="text-right tabular-nums">
                    {fmt.money(spentYear)}
                  </TableCell>
                  <TableCell data-label="All time" className="text-right tabular-nums">
                    {fmt.money(spentTotal)}
                  </TableCell>
                  <TableCell data-label="Last expense" data-phone-hidden className="text-muted-foreground">
                    {lastExpense ? fmt.calendarDate(lastExpense) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export default function VendorsPage(props: PageProps<"/finances/vendors">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Vendors searchParams={props.searchParams} />
    </Suspense>
  );
}

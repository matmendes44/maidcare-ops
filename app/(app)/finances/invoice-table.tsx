import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import type { Formatters } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { displayName } from "../customers/options";
import type { CustomerOption } from "../properties/customer-picker";
import type { getInvoices, SortKey } from "./data";
import { LinkCustomer } from "./link-customer";
import { paidViaLabels } from "./paid-via";

type Row = Awaited<ReturnType<typeof getInvoices>>["rows"][number];


// "Check #1042" when the app recorded what an outside payment was; else the
// kind of payment (in English: pass it through tr())
export function paidViaLabel(r: { paidVia: Row["paidVia"]; paidViaNote: string | null }) {
  if (!r.paidVia) return null;
  return r.paidVia !== "stripe" && r.paidViaNote ? r.paidViaNote : paidViaLabels[r.paidVia];
}

export async function InvoiceStatusBadge({ status, isPastDue }: { status: Row["status"]; isPastDue: boolean }) {
  const { tr } = await getI18n();
  if (isPastDue)
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
        {tr("invoice|Past due")}
      </Badge>
    );
  const map = {
    draft: { label: "invoice|Draft", variant: "muted" },
    open: { label: "invoice|Open", variant: "info" },
    paid: { label: "invoice|Paid", variant: "success" },
    void: { label: "invoice|Void", variant: "muted" },
    uncollectible: { label: "invoice|Uncollectible", variant: "muted" },
  } as const;
  const { label, variant } = map[status];
  return (
    <Badge variant={variant} className={cn(status === "void" && "line-through")}>
      {tr(label)}
    </Badge>
  );
}

function SortHead({
  k,
  children,
  className,
  sortHref,
  sort,
  dir,
}: {
  k: SortKey;
  children: React.ReactNode;
  className?: string;
  sortHref?: (key: SortKey) => string;
  sort?: SortKey;
  dir?: "asc" | "desc";
}) {
  if (!sortHref) return <TableHead className={className}>{children}</TableHead>;
  const active = sort === k;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={sortHref(k)} scroll={false} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        <Icon className={active ? "size-3.5" : "size-3.5 text-muted-foreground/50"} aria-hidden="true" />
      </Link>
    </TableHead>
  );
}

export async function InvoiceTable({
  rows,
  fmt,
  showCustomer = true,
  linkOptions,
  sortHref,
  sort,
  dir,
}: {
  rows: Row[];
  fmt: Formatters;
  showCustomer?: boolean;
  // customers to choose from when linking an unlinked invoice
  linkOptions?: CustomerOption[];
  // builds the link for sorting by a column; omit for an unsortable table
  sortHref?: (key: SortKey) => string;
  sort?: SortKey;
  dir?: "asc" | "desc";
}) {
  const { tr } = await getI18n();
  const dash = "—";
  const sortLabels: Record<SortKey, string> = {
    created: tr("Created"),
    due: tr("Due date"),
    total: tr("Total"),
  };
  return (
    <>
      {/* phones hide the column headers, so sorting gets its own row */}
      {sortHref && (
        <div className="mb-2 flex items-center gap-1.5 text-sm sm:hidden">
          <span className="mr-1 text-muted-foreground">{tr("Sort")}</span>
          {(Object.keys(sortLabels) as SortKey[]).map((k) => {
            const active = sort === k;
            const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
            return (
              <Link
                key={k}
                href={sortHref(k)}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1",
                  active ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground",
                )}
              >
                {sortLabels[k]}
                <Icon className="size-3.5" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("Invoice")}</TableHead>
              {showCustomer && <TableHead>{tr("Customer")}</TableHead>}
              <TableHead>{tr("Status")}</TableHead>
              <SortHead k="total" className="text-right" sortHref={sortHref} sort={sort} dir={dir}>
                {tr("Total")}
              </SortHead>
              <TableHead className="text-right">{tr("Amount due")}</TableHead>
              <TableHead className="text-right">{tr("amount|Paid")}</TableHead>
              <SortHead k="created" sortHref={sortHref} sort={sort} dir={dir}>
                {tr("Created")}
              </SortHead>
              <SortHead k="due" sortHref={sortHref} sort={sort} dir={dir}>
                {tr("Due date")}
              </SortHead>
              <TableHead>{tr("Paid on")}</TableHead>
              <TableHead>{tr("Paid via")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showCustomer ? 10 : 9} className="py-10 text-center text-muted-foreground">
                  {tr("No invoices match.")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell data-primary>
                    <Link
                      href={`/finances/invoices/${r.id}`}
                      className="font-mono text-[0.85rem] font-semibold text-link underline-offset-4 hover:underline"
                    >
                      {r.number ?? tr("invoice|Draft")}
                    </Link>
                    {r.invoicePdfUrl && (
                      <a
                        href={r.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-muted-foreground hover:text-foreground"
                      >
                        <FileText className="size-3" aria-hidden="true" />
                        PDF
                      </a>
                    )}
                  </TableCell>
                  {showCustomer && (
                    <TableCell data-label={tr("Customer")} className="whitespace-normal">
                      {r.customerId ? (
                        <>
                          <Link href={`/customers/${r.customerId}`} className="font-medium text-link underline-offset-4 hover:underline">
                            {r.customerCode} {displayName(r)}
                          </Link>
                          {r.propertyStreet && <div className="text-[0.8rem] text-muted-foreground">{r.propertyStreet}</div>}
                        </>
                      ) : (
                        <div className="grid gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="border-amber-500/40 text-amber-800 dark:text-amber-300">
                              {tr("Not linked")}
                            </Badge>
                            {linkOptions && (
                              <LinkCustomer stripeCustomerId={r.stripeCustomerId} stripeName={r.customerName} customers={linkOptions} />
                            )}
                          </div>
                          <div className="text-[0.8rem] text-muted-foreground">
                            {r.customerName ?? r.stripeCustomerId}
                            {r.customerEmail && ` · ${r.customerEmail}`}
                          </div>
                        </div>
                      )}
                    </TableCell>
                  )}
                  <TableCell data-label={tr("Status")}>
                    <InvoiceStatusBadge status={r.status} isPastDue={r.isPastDue} />
                  </TableCell>
                  <TableCell data-label={tr("Total")} className="text-right font-medium tabular-nums">
                    {fmt.money(r.totalCents)}
                  </TableCell>
                  <TableCell
                    data-label={tr("Amount due")}
                    data-phone-hidden={r.status === "draft" || r.status === "void" || r.status === "paid" || undefined}
                    className="text-right tabular-nums"
                  >
                    {r.status === "draft" || r.status === "void" ? dash : fmt.money(r.amountRemainingCents)}
                  </TableCell>
                  <TableCell data-label={tr("amount|Paid")} data-phone-hidden={!r.amountPaidCents || undefined} className="text-right tabular-nums">
                    {r.amountPaidCents ? fmt.money(r.amountPaidCents) : dash}
                  </TableCell>
                  <TableCell data-label={tr("Created")}>{fmt.date(r.createdAt)}</TableCell>
                  <TableCell data-label={tr("Due date")} data-phone-hidden={!r.dueDate || r.status === "paid" || undefined}>
                    {r.dueDate ? fmt.date(r.dueDate) : dash}
                  </TableCell>
                  <TableCell data-label={tr("Paid on")} data-phone-hidden={!r.paidAt || undefined}>
                    {r.paidAt ? fmt.date(r.paidAt) : dash}
                  </TableCell>
                  <TableCell data-label={tr("Paid via")} data-phone-hidden={!r.paidVia || undefined} className="whitespace-normal">
                    {r.paidVia ? tr(paidViaLabel(r)!) : dash}
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, List, Pencil, Plus, Store, Trash2 } from "lucide-react";
import { Kpi } from "@/components/charts";
import { ConfirmButton } from "@/components/confirm-button";
import { PageLoading } from "@/components/page-loading";
import { Field, FieldColumn, FieldGroup, RecordType, linkClass } from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { categoryLabel, frequencies } from "@/lib/expenses/options";
import { getI18n } from "@/lib/i18n/server";
import { getExpenses, parseExpenseFilters } from "../../expenses/data";
import { ExpenseTable } from "../../expenses/expense-table";
import { NoAccess } from "../../no-access";
import { deleteVendor } from "../actions";
import { getAdjacentVendors, getVendor, parseVendorId } from "../data";

const savedMessages: Record<string, string> = { created: "Vendor added.", updated: "Changes saved." };

async function VendorRecord({ params, searchParams }: Pick<PageProps<"/finances/vendors/[id]">, "params" | "searchParams">) {
  const user = await getCurrentUser();
  if (!can(user, "vendors.view")) return <NoAccess what="vendors" />;
  const id = parseVendorId((await params).id);
  const v = id === null ? null : await getVendor(id);
  if (!v) notFound();
  const sp = await searchParams;
  const filters = { ...parseExpenseFilters(sp), vendor: v.id, q: "", category: null, method: null, from: null, to: null, recurring: null, receipt: null };
  const [{ rows, total }, { prevId, nextId }, { fmt }] = await Promise.all([getExpenses(filters), getAdjacentVendors(v.vendorCode), getI18n()]);
  const manage = can(user, "expenses.manage");
  const nav = "size-9 text-muted-foreground hover:text-foreground";
  const sortHref = (k: string) => `/finances/vendors/${v.id}?sort=${k}&dir=${filters.sort === k && filters.dir === "desc" ? "asc" : "desc"}`;

  return (
    <>
      {typeof sp.saved === "string" && savedMessages[sp.saved] && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {savedMessages[sp.saved]}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <RecordType icon={Store}>Vendor</RecordType>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xl font-bold">
            <span>
              <span className="text-muted-foreground">{v.vendorCode}</span> {v.name}
            </span>
            <Badge variant={v.isActive ? "success" : "muted"} className="h-7 px-3 text-[0.8rem]">
              {v.isActive ? "Active" : "Inactive"}
            </Badge>
          </h1>
          {v.contractorId && (
            <p className="mt-1 text-sm">
              Contractor:{" "}
              <Link href={`/contractors/${v.contractorId}`} className={linkClass}>
                see days worked, pay and 1099s
              </Link>
            </p>
          )}
        </div>
        <nav aria-label="Vendors" className="flex items-center gap-1">
          {[
            { id: prevId, icon: ArrowLeft, label: "Previous vendor" },
            { id: nextId, icon: ArrowRight, label: "Next vendor" },
          ].map(({ id: to, icon: Icon, label }) =>
            to ? (
              <Link key={label} href={`/finances/vendors/${to}`} className={buttonVariants({ variant: "ghost", size: "icon", className: nav })} aria-label={label}>
                <Icon aria-hidden="true" />
              </Link>
            ) : (
              <span key={label} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "opacity-30")} aria-hidden="true">
                <Icon />
              </span>
            ),
          )}
          <Link href="/finances/vendors" className={buttonVariants({ variant: "ghost", className: "text-muted-foreground" })}>
            <List aria-hidden="true" />
            List
          </Link>
        </nav>
      </div>

      {manage && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-b pb-4">
          <Link href={`/finances/vendors/${v.id}/edit`} className={buttonVariants()}>
            <Pencil aria-hidden="true" />
            Edit
          </Link>
          <Link href={`/finances/expenses/new?vendor=${v.id}`} className={buttonVariants({ variant: "outline" })}>
            <Plus aria-hidden="true" />
            New expense
          </Link>
          <span className="flex-1" />
          <ConfirmButton
            label="Delete"
            icon={<Trash2 aria-hidden="true" />}
            title={`Delete ${v.vendorCode} ${v.name}?`}
            description="Only vendors with no expenses can be deleted. Vendors with history can be marked inactive instead (Edit → Status)."
            confirmLabel="Delete vendor"
            cancelLabel="Keep it"
            action={deleteVendor.bind(null, v.id)}
          />
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="This year" value={fmt.money(v.totals.thisYear)} />
        <Kpi label="Last year" value={fmt.money(v.totals.lastYear)} />
        <Kpi label="All time" value={fmt.money(v.totals.allTime)} sub={`${v.totals.count} expenses`} />
        <Kpi label="Last expense" value={v.totals.last ? fmt.calendarDate(v.totals.last) : "—"} sub={v.totals.count ? `average ${fmt.money(Math.round(v.totals.allTime / v.totals.count))}` : undefined} />
      </div>

      <div className="mt-6">
        <FieldGroup title="Details">
          <FieldColumn>
            <Field label="Usual category">{v.defaultCategory ? categoryLabel(v.defaultCategory) : null}</Field>
            <Field label="Our account number">{v.accountNumber}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label="Contact person">{v.contactName}</Field>
            <Field label="Phone">{v.phone && <a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className={linkClass}>{v.phone}</a>}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label="Email">{v.email && <a href={`mailto:${v.email}`} className={linkClass}>{v.email}</a>}</Field>
            <Field label="Website">
              {v.website && (
                <a href={v.website} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {v.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              )}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label="Address">{v.address}</Field>
            <Field label="Added">
              {fmt.calendarDate(v.createdAt.slice(0, 10))}
              {v.createdByName && <span className="text-muted-foreground"> by {v.createdByName}</span>}
            </Field>
          </FieldColumn>
        </FieldGroup>
        {v.notes && (
          <FieldGroup title="Notes">
            <p className="col-span-full whitespace-pre-wrap">{v.notes}</p>
          </FieldGroup>
        )}
      </div>

      {v.schedules.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Recurring</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {v.schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="font-medium">{frequencies[s.frequency]}</span>
                <span className="tabular-nums">
                  {s.amountVaries && "~"}
                  {fmt.money(s.amountCents)}
                </span>
                <span className="text-muted-foreground">{categoryLabel(s.category)}</span>
                <span className="text-muted-foreground">{s.endDate ? `ended ${fmt.calendarDate(s.endDate)}` : `since ${fmt.calendarDate(s.startDate)}`}</span>
                {manage && (
                  <Link href={`/finances/expenses/recurring/${s.id}/edit`} className="ml-auto text-link underline-offset-4 hover:underline">
                    Edit
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Expenses <span className="text-muted-foreground">({total})</span>
          </h2>
          {total > rows.length && (
            <Link href={`/finances/expenses?tab=list&vendor=${v.id}`} className="text-sm text-link underline-offset-4 hover:underline">
              See all {total}
            </Link>
          )}
        </div>
        <ExpenseTable rows={rows} fmt={fmt} hideVendor sort={filters.sort} dir={filters.dir} sortHref={sortHref} empty="No expenses from this vendor yet." />
      </section>
    </>
  );
}

export default function VendorPage(props: PageProps<"/finances/vendors/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <VendorRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

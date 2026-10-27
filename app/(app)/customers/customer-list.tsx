import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { Suspense } from "react";
import { and, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus } from "lucide-react";
import { db } from "@/db";
import { outer } from "@/lib/db-helpers";
import { requireUser } from "@/lib/auth/session";
import { contacts, customers, properties } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getI18n } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/tr";
import type { Messages } from "@/lib/i18n/messages";
import { displayName } from "./options";
import { SearchBox, SearchBoxFallback } from "./search-box";
import { statusVariant } from "./status";

type SortDir = "asc" | "desc";

// Leads (people who haven't booked yet) and customers share one list, on two
// pages. A lead becomes a customer when they accept a quote.
export type ListKind = "customers" | "leads";
const basePath = (kind: ListKind) => `/${kind}`;

// Each sort key maps to the SQL expressions it orders by. Sorting happens in
// the database so it stays correct however the list grows.
const sortOptions = {
  code: {
    defaultDir: "asc",
    // length first so C10000 sorts after C9999
    by: [sql`length(${customers.customerCode})`, sql`${customers.customerCode}`],
  },
  name: {
    defaultDir: "asc",
    by: [sql`lower(coalesce(nullif(concat_ws(' ', ${customers.firstName}, ${customers.lastName}), ''), ${customers.companyName}))`],
  },
  type: { defaultDir: "asc", by: [sql`${customers.type}`] },
  // enum order: lead → active → paused → inactive
  status: { defaultDir: "asc", by: [sql`${customers.status}`] },
  email: { defaultDir: "asc", by: [sql`lower(${customers.email})`] },
  created: { defaultDir: "desc", by: [sql`${customers.createdAt}`] },
} satisfies Record<string, { defaultDir: SortDir; by: SQL[] }>;

type SortKey = keyof typeof sortOptions;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// leads have one status, so that column is left out of their list
const columnsFor = (kind: ListKind): SortKey[] =>
  (Object.keys(sortOptions) as SortKey[]).filter((c) => kind === "customers" || c !== "status");

function parseParams(kind: ListKind, params: Record<string, string | string[] | undefined>) {
  const raw = first(params.sort);
  // newest leads first; customers by name
  const sort: SortKey = raw && columnsFor(kind).includes(raw as SortKey) ? (raw as SortKey) : kind === "leads" ? "created" : "name";
  const rawDir = first(params.dir);
  const dir: SortDir = rawDir === "asc" || rawDir === "desc" ? rawDir : sortOptions[sort].defaultDir;
  const q = first(params.q)?.trim() ?? "";
  return { sort, dir, q };
}

// Matches the customer's own fields plus their contacts (name, email, phone)
// and property addresses. Phone matching ignores formatting, so "4105551234"
// finds "(410) 555-1234".
function searchCondition(q: string) {
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const digits = q.replace(/\D/g, "");
  const phoneMatch = digits.length >= 3 ? sql`or regexp_replace(${contacts.phone}, '\\D', '', 'g') like ${`%${digits}%`}` : sql``;

  return or(
    ilike(customers.customerCode, pattern),
    ilike(customers.companyName, pattern),
    ilike(customers.email, pattern),
    sql`concat_ws(' ', ${customers.firstName}, ${customers.lastName}) ilike ${pattern}`,
    sql`exists (select 1 from ${contacts} where ${outer(contacts.customerId)} = ${outer(customers.id)}
      and (${contacts.name} ilike ${pattern} or ${contacts.email} ilike ${pattern} ${phoneMatch}))`,
    sql`exists (select 1 from ${properties} where ${outer(properties.customerId)} = ${outer(customers.id)}
      and concat_ws(' ', ${properties.street}, ${properties.unit}, ${properties.city}, ${properties.zip}) ilike ${pattern})`,
  );
}

async function getCustomers(kind: ListKind, sort: SortKey, dir: SortDir, q: string) {
  await requireUser();
  const direction = dir === "asc" ? sql`asc` : sql`desc`;
  const orderBy = sortOptions[sort].by.map((expr) => sql`${expr} ${direction} nulls last`);
  return db
    .select()
    .from(customers)
    .where(and(kind === "leads" ? eq(customers.status, "lead") : ne(customers.status, "lead"), q ? searchCondition(q) : undefined))
    .orderBy(...orderBy, customers.id);
}

function SortHeader({
  kind,
  column,
  sort,
  dir,
  q,
  labels,
}: {
  kind: ListKind;
  column: SortKey;
  sort: SortKey;
  dir: SortDir;
  q: string;
  labels: Messages["customers"]["columns"];
}) {
  const active = column === sort;
  const nextDir: SortDir = active ? (dir === "asc" ? "desc" : "asc") : sortOptions[column].defaultDir;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  const params = new URLSearchParams({ sort: column, dir: nextDir });
  if (q) params.set("q", q);

  return (
    <TableHead aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={`${basePath(kind)}?${params}`} scroll={false} className="inline-flex items-center gap-1 hover:text-foreground">
        {labels[column]}
        <Icon className={active ? "size-3.5" : "size-3.5 text-muted-foreground/50"} aria-hidden="true" />
      </Link>
    </TableHead>
  );
}

// Phones hide the column headers, so sorting gets a row of its own.
function PhoneSort({
  kind,
  sort,
  dir,
  q,
  labels,
  sortLabel,
}: {
  kind: ListKind;
  sort: SortKey;
  dir: SortDir;
  q: string;
  labels: Messages["customers"]["columns"];
  sortLabel: string;
}) {
  const columns = (["name", "code", "status", "created"] as SortKey[]).filter((c) => columnsFor(kind).includes(c));
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm sm:hidden">
      <span className="mr-1 text-muted-foreground">{sortLabel}</span>
      {columns.map((column) => {
        const active = column === sort;
        const nextDir: SortDir = active ? (dir === "asc" ? "desc" : "asc") : sortOptions[column].defaultDir;
        const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
        const params = new URLSearchParams({ sort: column, dir: nextDir });
        if (q) params.set("q", q);
        return (
          <Link
            key={column}
            href={`${basePath(kind)}?${params}`}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={
              active
                ? "inline-flex items-center gap-1 rounded-md border border-brand-blue bg-brand-blue/10 px-2 py-1 font-medium"
                : "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground"
            }
          >
            {labels[column]}
            <Icon className="size-3.5" aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function CustomerList({ kind, searchParams }: { kind: ListKind; searchParams: SearchParams }) {
  const [{ sort, dir, q }, { t, fmt, tr }] = await Promise.all([searchParams.then((p) => parseParams(kind, p)), getI18n()]);
  const rows = await getCustomers(kind, sort, dir, q);
  const columns = columnsFor(kind);

  return (
    <>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {kind === "leads"
          ? q
            ? plural(tr, rows.length, "{n} lead matching “{q}”", "{n} leads matching “{q}”", { q })
            : plural(tr, rows.length, "{n} lead", "{n} leads")
          : q
            ? t.customers.countMatching(rows.length, q)
            : t.customers.count(rows.length)}{" "}
        · {t.customers.sortedBy(t.customers.columns[sort].toLowerCase(), dir === "asc")}
      </p>

      <PhoneSort kind={kind} sort={sort} dir={dir} q={q} labels={t.customers.columns} sortLabel={tr("Sort")} />
      <div className="mt-4 overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <SortHeader key={column} kind={kind} column={column} sort={sort} dir={dir} q={q} labels={t.customers.columns} />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10 text-center text-muted-foreground">
                  {kind === "leads"
                    ? q
                      ? tr("No leads match that search.")
                      : tr("No leads right now.")
                    : q
                      ? t.customers.noMatches
                      : t.customers.none}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => {
                const name = displayName(c);
                const showCompany = c.companyName && c.companyName !== name;
                return (
                  // The name link stretches over the whole row, so clicking
                  // anywhere on it opens the customer.
                  <TableRow key={c.id} className="relative cursor-pointer">
                    <TableCell data-label={t.customers.columns.code} className="font-mono text-[0.8rem] text-muted-foreground">
                      {c.customerCode}
                    </TableCell>
                    <TableCell data-primary>
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-semibold text-foreground hover:text-link after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {name}
                      </Link>
                      {showCompany && <div className="text-[0.8rem] text-muted-foreground">{c.companyName}</div>}
                    </TableCell>
                    <TableCell data-label={t.customers.columns.type}>{t.enums.customerType[c.type]}</TableCell>
                    {kind === "customers" && (
                      <TableCell data-label={t.customers.columns.status}>
                        <Badge variant={statusVariant[c.status]}>{t.enums.customerStatus[c.status]}</Badge>
                      </TableCell>
                    )}
                    <TableCell data-label={t.customers.columns.email} className="text-muted-foreground">
                      {c.email ?? "—"}
                    </TableCell>
                    <TableCell data-label={t.customers.columns.created} data-phone-hidden className="text-muted-foreground">
                      {fmt.date(c.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export async function CustomersIndex({ kind, searchParams }: { kind: ListKind; searchParams: SearchParams }) {
  const [{ t, tr }, params, user] = await Promise.all([getI18n(), searchParams, getCurrentUser()]);
  // anyone can add a lead; adding a customer directly needs permission
  const canAdd = kind === "leads" || can(user, "customers.create");
  const deleted = typeof params.deleted === "string" ? params.deleted : null;
  const leads = kind === "leads";
  return (
    <div>
      {deleted && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground"
        >
          {params.stripe === "deleted"
            ? tr("{name} was deleted here and in Stripe.", { name: deleted })
            : params.stripe === "missing"
              ? tr("{name} was deleted. There was no matching customer in Stripe to delete.", { name: deleted })
              : tr("{name} was deleted.", { name: deleted })}
        </p>
      )}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{leads ? tr("Leads") : t.customers.title}</h1>
          {leads && (
            <p className="mt-1 text-sm text-muted-foreground">
              {tr("People who haven't booked yet. A lead becomes a customer when they accept a quote.")}
            </p>
          )}
        </div>
        {canAdd && (
          <Link href={leads ? "/customers/new?lead=1" : "/customers/new"} className={buttonVariants()}>
            <Plus aria-hidden="true" />
            {leads ? tr("Create New Lead") : t.customers.add}
          </Link>
        )}
      </div>
      <div className="mb-4">
        <Suspense fallback={<SearchBoxFallback label={leads ? tr("Search leads") : t.customers.searchLabel} />}>
          <SearchBox label={leads ? tr("Search leads") : t.customers.searchLabel} placeholder={t.customers.searchPlaceholder} />
        </Suspense>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t.common.loading}</p>}>
        <CustomerList kind={kind} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

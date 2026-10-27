import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayName } from "../customers/options";
import { SearchBox, SearchBoxFallback } from "../customers/search-box";
import { getProperties } from "./data";
import { PageLoading } from "@/components/page-loading";
import { getI18n } from "@/lib/i18n/server";

async function PropertyList({ searchParams }: Pick<PageProps<"/properties">, "searchParams">) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const [rows, { t }, user] = await Promise.all([getProperties(q), getI18n(), getCurrentUser()]);
  const canEdit = can(user, "properties.edit");

  return (
    <>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {q ? t.properties.countMatching(rows.length, q) : t.properties.count(rows.length)}
      </p>
      <div className="mt-4 overflow-hidden rounded-lg border">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>{t.properties.columns.address}</TableHead>
              <TableHead>{t.properties.columns.customer}</TableHead>
              <TableHead>{t.properties.columns.zone}</TableHead>
              <TableHead>{t.properties.columns.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {q ? t.properties.noMatches : t.properties.none}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => (
                // The address link stretches over the row; the customer link
                // sits above it so both stay clickable.
                <TableRow key={p.id} className="relative">
                  <TableCell data-primary>
                    {canEdit ? (
                      <Link
                        href={`/properties/${p.id}/edit`}
                        className="font-semibold text-foreground after:absolute after:inset-0 hover:text-link focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {p.street}
                        {p.unit && `, ${p.unit}`}
                      </Link>
                    ) : (
                      <span className="font-semibold">
                        {p.street}
                        {p.unit && `, ${p.unit}`}
                      </span>
                    )}
                    <div className="text-[0.8rem] text-muted-foreground">
                      {p.city}, {p.state} {p.zip}
                    </div>
                  </TableCell>
                  <TableCell data-label={t.properties.columns.customer}>
                    <Link
                      href={`/customers/${p.customerId}`}
                      className="relative z-10 text-link underline-offset-4 hover:underline"
                    >
                      {displayName(p)}
                    </Link>
                    <span className="ml-1.5 font-mono text-[0.8rem] text-muted-foreground">
                      {p.customerCode}
                    </span>
                    {p.isBilling && (
                      <Badge variant="info" className="ml-2">{t.properties.billing}</Badge>
                    )}
                  </TableCell>
                  <TableCell data-label={t.properties.columns.zone}>{p.zone ? t.enums.zone[p.zone] : t.common.none}</TableCell>
                  <TableCell data-label={t.properties.columns.status}>
                    <Badge variant={p.isActive ? "success" : "muted"}>
                      {p.isActive ? t.properties.active : t.properties.inactive}
                    </Badge>
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

async function PropertiesContent({ searchParams }: Pick<PageProps<"/properties">, "searchParams">) {
  const { t } = await getI18n();
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t.properties.title}</h1>
        <Link href="/properties/new" className={buttonVariants()}>
          <Plus aria-hidden="true" />
          {t.properties.add}
        </Link>
      </div>
      <div className="mb-4">
        <Suspense fallback={<SearchBoxFallback label={t.properties.searchLabel} />}>
          <SearchBox label={t.properties.searchLabel} placeholder={t.properties.searchPlaceholder} />
        </Suspense>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t.common.loading}</p>}>
        <PropertyList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

export default function PropertiesPage(props: PageProps<"/properties">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PropertiesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

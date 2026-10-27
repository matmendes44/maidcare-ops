import "server-only";

import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/lib/db-helpers";
import { contacts, customers, invoices, properties, vendors } from "@/db/schema";
import { displayName } from "@/app/(app)/customers/options";
import { formatAddress } from "@/app/(app)/properties/options";
import type { Locale } from "@/lib/i18n/config";
import { formatters } from "@/lib/i18n/format";
import { translator } from "@/lib/i18n/tr";

export type SearchResult = {
  kind: "customer" | "property" | "invoice" | "vendor";
  id: number;
  title: string;
  subtitle: string;
  href: string;
};

const PER_KIND = 6;

// The header search: customers (code, name, company, email, or a contact's
// name, email or phone), properties (address) and invoices (number or the
// name billed). Case-insensitive "contains" matching; phone numbers match on
// digits alone, so "410 555" finds "(410) 555-1234". Vendors (code, name,
// contact, account number) only for people who may see expenses.
export async function searchEverything(raw: string, { withVendors = false, locale = "en-US" as Locale } = {}): Promise<SearchResult[]> {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return [];
  // the text is matched literally: % and _ aren't wildcards
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits.length >= 3 ? `%${digits}%` : null;
  const phoneMatches = (column: SQL | typeof contacts.phone | typeof vendors.phone) =>
    phoneLike ? sql`regexp_replace(coalesce(${column}, ''), '\\D', '', 'g') like ${phoneLike}` : sql`false`;

  const [customerRows, propertyRows, invoiceRows, vendorRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        customerCode: customers.customerCode,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        email: customers.email,
        status: customers.status,
      })
      .from(customers)
      .where(
        or(
          ilike(customers.customerCode, like),
          ilike(sql`concat_ws(' ', ${customers.firstName}, ${customers.lastName})`, like),
          ilike(customers.companyName, like),
          ilike(customers.email, like),
          sql`exists (select 1 from ${contacts} where ${outer(contacts.customerId)} = ${outer(customers.id)} and (
            ${contacts.name} ilike ${like} or ${contacts.email} ilike ${like} or ${phoneMatches(contacts.phone)}))`,
        ),
      )
      // exact code first, then names that start with the text
      .orderBy(
        desc(sql`lower(${customers.customerCode}) = lower(${q})`),
        desc(sql`concat_ws(' ', ${customers.firstName}, ${customers.lastName}) ilike ${`${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`),
        asc(customers.firstName),
        asc(customers.lastName),
      )
      .limit(PER_KIND),
    db
      .select({ property: properties, customer: { id: customers.id, customerCode: customers.customerCode, firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName } })
      .from(properties)
      .innerJoin(customers, eq(customers.id, properties.customerId))
      .where(
        or(
          ilike(sql`concat_ws(' ', ${properties.street}, ${properties.unit}, ${properties.city}, ${properties.state}, ${properties.zip})`, like),
        ),
      )
      .orderBy(desc(properties.isActive), asc(properties.street))
      .limit(PER_KIND),
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        totalCents: invoices.totalCents,
        customerName: invoices.customerName,
        createdAt: invoices.createdAt,
        customer: { customerCode: customers.customerCode, firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName },
      })
      .from(invoices)
      .leftJoin(customers, eq(customers.id, invoices.customerId))
      .where(
        or(
          ilike(invoices.number, like),
          ilike(invoices.customerName, like),
          and(sql`${customers.id} is not null`, ilike(sql`concat_ws(' ', ${customers.customerCode}, ${customers.firstName}, ${customers.lastName}, ${customers.companyName})`, like)),
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(PER_KIND),
    withVendors
      ? db
          .select({ id: vendors.id, code: vendors.vendorCode, name: vendors.name, contactName: vendors.contactName, isActive: vendors.isActive })
          .from(vendors)
          .where(or(ilike(vendors.vendorCode, like), ilike(vendors.name, like), ilike(vendors.contactName, like), ilike(vendors.accountNumber, like), phoneMatches(vendors.phone)))
          .orderBy(desc(sql`lower(${vendors.vendorCode}) = lower(${q})`), desc(vendors.isActive), asc(vendors.name))
          .limit(PER_KIND)
      : Promise.resolve([]),
  ]);

  const { money } = formatters(locale);
  const tr = translator(locale);
  const status = (kind: "customer" | "invoice", s: string) => {
    const label = `${kind}|${s.charAt(0).toUpperCase()}${s.slice(1)}`;
    return tr(label);
  };
  return [
    ...customerRows.map((c) => ({
      kind: "customer" as const,
      id: c.id,
      title: `${c.customerCode} ${displayName(c)}`,
      subtitle: [status("customer", c.status), c.email].filter(Boolean).join(" · "),
      href: `/customers/${c.id}`,
    })),
    ...propertyRows.map(({ property: p, customer: c }) => ({
      kind: "property" as const,
      id: p.id,
      title: formatAddress(p),
      subtitle: `${c.customerCode} ${displayName(c)}${p.isActive ? "" : ` · ${tr("inactive")}`}`,
      href: `/properties/${p.id}/edit`,
    })),
    ...invoiceRows.map((i) => ({
      kind: "invoice" as const,
      id: i.id,
      title: `${i.number ?? tr("Draft invoice")} · ${money(i.totalCents)}`,
      subtitle: `${i.customer?.customerCode ? `${i.customer.customerCode} ${displayName(i.customer)}` : (i.customerName ?? tr("Not linked"))} · ${status("invoice", i.status)}`,
      href: `/finances/invoices/${i.id}`,
    })),
    ...vendorRows.map((v) => ({
      kind: "vendor" as const,
      id: v.id,
      title: `${v.code} ${v.name}`,
      subtitle: [tr("Vendor"), v.contactName, v.isActive ? null : tr("inactive")].filter(Boolean).join(" · "),
      href: `/finances/vendors/${v.id}`,
    })),
  ];
}

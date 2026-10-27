import { asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, properties } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";

export function parsePropertyId(raw: string) {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function getProperties(q: string) {
  await requireUser();
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  return db
    .select({
      id: properties.id,
      street: properties.street,
      unit: properties.unit,
      city: properties.city,
      state: properties.state,
      zip: properties.zip,
      zone: properties.zone,
      isActive: properties.isActive,
      customerId: customers.id,
      customerCode: customers.customerCode,
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
      isBilling: sql<boolean>`coalesce(${customers.billingPropertyId} = ${properties.id}, false)`,
    })
    .from(properties)
    .innerJoin(customers, eq(customers.id, properties.customerId))
    .where(
      q
        ? or(
            sql`concat_ws(' ', ${properties.street}, ${properties.unit}, ${properties.city}, ${properties.zip}) ilike ${pattern}`,
            sql`concat_ws(' ', ${customers.firstName}, ${customers.lastName}) ilike ${pattern}`,
            ilike(customers.companyName, pattern),
            ilike(customers.customerCode, pattern),
          )
        : undefined,
    )
    .orderBy(desc(properties.isActive), asc(properties.street), asc(properties.id));
}

export async function getProperty(id: number) {
  await requireUser();
  const [row] = await db
    .select({
      property: properties,
      isBilling: sql<boolean>`coalesce(${customers.billingPropertyId} = ${properties.id}, false)`,
    })
    .from(properties)
    .innerJoin(customers, eq(customers.id, properties.customerId))
    .where(eq(properties.id, id));
  return row ? { ...row.property, isBilling: row.isBilling } : null;
}

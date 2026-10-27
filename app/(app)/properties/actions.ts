"use server";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { appointments, customers, properties } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { asUser, nextId, pgError } from "@/lib/db-helpers";
import { geocodeProperty } from "@/lib/geocode";
import { syncStripeCustomer, syncStripeCustomers } from "@/lib/stripe-customers";
import { getI18n } from "@/lib/i18n/server";
import type { Messages } from "@/lib/i18n/messages";
import { addressToRow, readAddress, validateAddress, type AddressField } from "./options";
import { logError } from "@/lib/log";

export type PropertyField = AddressField | "customerId" | "accessNotes" | "serviceNotes";

export type PropertyFormState = {
  errors?: Partial<Record<PropertyField, string>>;
  message?: string;
};

function parse(formData: FormData, t: Messages) {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const address = readAddress(formData);
  const errors: NonNullable<PropertyFormState["errors"]> = validateAddress(address, t);

  const customerId = Number(text("customerId"));
  if (!text("customerId") || !Number.isSafeInteger(customerId))
    errors.customerId = t.properties.errors.customer;

  return {
    customerId,
    row: {
      ...addressToRow(address),
      accessNotes: text("accessNotes") || null,
      serviceNotes: text("serviceNotes") || null,
    },
    // unchecked checkboxes aren't submitted
    isActive: formData.get("isActive") !== null,
    makeBilling: formData.get("billing") !== null,
    errors,
    hasErrors: Object.keys(errors).length > 0,
  };
}

function dbErrorState(err: unknown, t: Messages): PropertyFormState {
  const pg = pgError(err);
  if (pg?.code === "23503" && pg.constraint === "properties_customer_id_fkey")
    return { errors: { customerId: t.properties.errors.customerGone } };
  if (pg?.code === "23514" && pg.constraint === "properties_zip_check")
    return { errors: { zip: t.properties.errors.zip } };
  logError("property save failed", err);
  return { message: t.properties.errors.saveFailed };
}

// Billing address of `customerId` becomes `propertyId` when asked, or when the
// customer doesn't have one yet (so a customer's first property is the default).
function setBilling(customerId: number, propertyId: number, force: boolean) {
  return db
    .update(customers)
    .set({ billingPropertyId: propertyId })
    .where(
      and(
        eq(customers.id, customerId),
        force ? undefined : isNull(customers.billingPropertyId),
      ),
    );
}

export async function createProperty(
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  await requireUser();
  const { t } = await getI18n();
  const { customerId, row, makeBilling, errors, hasErrors } = parse(formData, t);
  if (hasErrors) return { errors };

  let id: number;
  try {
    id = await nextId("properties");
    await db.batch([
      db.insert(properties).values({ ...row, id, customerId }),
      setBilling(customerId, id, makeBilling),
    ]);
  } catch (err) {
    return dbErrorState(err, t);
  }

  // it may have become their billing address
  await syncStripeCustomer(customerId);
  // map location for the Fleet page, looked up after the response
  after(() => geocodeProperty(id).catch((err) => logError("geocode failed", err)));

  redirect(`/customers/${customerId}?saved=property`);
}

export async function updateProperty(
  id: number,
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const user = await requireUser();
  const { t, tr } = await getI18n();
  if (!can(user, "properties.edit")) return { message: tr("You don't have permission to edit properties.") };
  const { customerId, row, isActive, makeBilling, errors, hasErrors } = parse(formData, t);
  if (hasErrors) return { errors };

  const current = await db.query.properties.findFirst({
    columns: { customerId: true, street: true, city: true, state: true, zip: true },
    where: eq(properties.id, id),
  });
  if (!current) return { message: t.properties.errors.gone };
  const previousCustomerId = current.customerId;
  const addressChanged = (["street", "city", "state", "zip"] as const).some(
    (k) => String(row[k] ?? "").trim().toLowerCase() !== String(current[k] ?? "").trim().toLowerCase(),
  );
  const moved = previousCustomerId !== customerId;

  // All in one transaction, in this order:
  const statements: [BatchItem<"pg">, ...BatchItem<"pg">[]] = [
    // 0. Who's acting, for the appointment history written in step 5.
    asUser(user.id),
    // 1. Stop this property being anyone's billing address, except the
    //    (new) customer's when it's staying their billing address. The
    //    foreign key wouldn't allow the move otherwise.
    db
      .update(customers)
      .set({ billingPropertyId: null })
      .where(
        and(
          eq(customers.billingPropertyId, id),
          makeBilling ? ne(customers.id, customerId) : undefined,
        ),
      ),
    // 2. Save the property, possibly under its new customer.
    // a new address needs its map location looked up again
    db
      .update(properties)
      .set({ ...row, customerId, isActive, ...(addressChanged ? { lat: null, lng: null, geocodedAt: null, geocodeStatus: null } : {}) })
      .where(eq(properties.id, id)),
  ];

  // 3. Billing address for the (new) customer: when the box is ticked, or
  //    after a transfer to a customer who has none yet. Unticking on the same
  //    customer leaves it cleared.
  if (makeBilling || moved) statements.push(setBilling(customerId, id, makeBilling));

  // 4. After a transfer, the previous customer falls back to their next
  //    property if this one was their billing address.
  if (moved) {
    statements.push(
      db
        .update(customers)
        .set({
          billingPropertyId: sql`(
            select ${properties.id} from ${properties}
             where ${properties.customerId} = ${previousCustomerId}
             order by ${properties.isActive} desc, ${properties.id}
             limit 1)`,
        })
        .where(and(eq(customers.id, previousCustomerId), isNull(customers.billingPropertyId))),
    );
  }

  // 5. After a transfer, visits still to come go to the new owner; completed
  //    and canceled ones stay with the customer they were for.
  if (moved) {
    statements.push(
      db
        .update(appointments)
        .set({ customerId })
        .where(
          and(
            eq(appointments.propertyId, id),
            eq(appointments.customerId, previousCustomerId),
            inArray(appointments.status, ["pending", "in_progress"]),
          ),
        ),
    );
  }

  try {
    await db.batch(statements);
  } catch (err) {
    return dbErrorState(err, t);
  }

  // the billing address may have changed, for both customers after a transfer
  await syncStripeCustomers([customerId, previousCustomerId]);
  if (addressChanged) after(() => geocodeProperty(id).catch((err) => logError("geocode failed", err)));

  redirect(`/customers/${customerId}?saved=property`);
}

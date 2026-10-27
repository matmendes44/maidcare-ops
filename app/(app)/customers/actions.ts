"use server";

import { eq, inArray, or, sql } from "drizzle-orm";
import Stripe from "stripe";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser, checkPermission } from "@/lib/auth/session";
import { nextId, pgError } from "@/lib/db-helpers";
import { getI18n } from "@/lib/i18n/server";
import { describeStripeError, isStripeConfigured, stripe } from "@/lib/stripe";
import { createStripeCustomer, syncStripeCustomer } from "@/lib/stripe-customers";
import type { Messages } from "@/lib/i18n/messages";
import { appointments, contacts, customers, invoices, payments, properties, quotes } from "@/db/schema";
import { logError } from "@/lib/log";
import { can } from "@/lib/auth/permissions";
import {
  addressToRow,
  isAddressBlank,
  readAddress,
  validateAddress,
  type AddressErrors,
} from "../properties/options";
import {
  customerStatuses,
  customerTypes,
  endReasons,
  FIRST_PROPERTY_PREFIX,
  normalizeCustomerForm,
  normalizePhone,
  type CustomerField,
  type CustomerStatus,
  type CustomerType,
  type EndReason,
} from "./options";
import { getNextCustomerCode } from "./data";
import { LEAD_TYPES, type LeadFormState } from "./lead-options";

export type CustomerFormState = {
  errors?: Partial<Record<CustomerField, string>>;
  // the first property, entered on the new-customer form
  propertyErrors?: AddressErrors;
  message?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

// `previousStatus` is the customer's status before this edit (undefined when
// creating). Reasons for leaving are required when a customer is *set* to
// inactive; customers who were already inactive before reasons existed can be
// edited without inventing one.
function parse(
  formData: FormData,
  t: Messages,
  { selfId, previousStatus }: { selfId?: number; previousStatus?: CustomerStatus } = {},
) {
  const e = t.customers.errors;
  const values = normalizeCustomerForm(formData);
  const errors: NonNullable<CustomerFormState["errors"]> = {};

  if (!values.customerCode) errors.customerCode = e.codeRequired;
  else if (/\s/.test(values.customerCode))
    errors.customerCode = e.codeSpaces;

  if (!customerTypes.includes(values.type as CustomerType))
    errors.type = e.typeRequired;
  if (!customerStatuses.includes(values.status as CustomerStatus))
    errors.status = e.statusRequired;

  if (!values.startDate) errors.startDate = e.startRequired;
  else if (!isValidDate(values.startDate)) errors.startDate = e.invalidDate;

  const inactive = values.status === "inactive";
  const reasons = values.endReasons ? (values.endReasons.split(",") as EndReason[]) : [];
  if (inactive) {
    if (!values.endDate) errors.endDate = e.endRequired;
    else if (!isValidDate(values.endDate)) errors.endDate = e.invalidDate;
    // ISO dates compare correctly as strings
    else if (values.startDate && values.endDate < values.startDate)
      errors.endDate = e.endBeforeStart;

    if (reasons.some((r) => !endReasons.includes(r)))
      errors.endReasons = e.reasonsFromList;
    else if (reasons.length === 0 && previousStatus !== "inactive")
      errors.endReasons = e.reasonsRequired;
  }

  // mirrors the customers_check constraint in the database
  if (!values.firstName && !values.companyName)
    errors.firstName = e.nameRequired;

  if (values.email && !EMAIL_RE.test(values.email))
    errors.email = e.invalidEmail;

  const referredById = values.referredById ? Number(values.referredById) : null;
  if (referredById !== null && !Number.isSafeInteger(referredById))
    errors.referredById = e.referrerFromList;
  else if (referredById !== null && referredById === selfId)
    errors.referredById = e.selfReferral;

  const billingPropertyId = values.billingPropertyId ? Number(values.billingPropertyId) : null;
  if (billingPropertyId !== null && !Number.isSafeInteger(billingPropertyId))
    errors.billingPropertyId = e.billingFromList;

  if (values.stripeCustomerId && !values.stripeCustomerId.startsWith("cus_"))
    errors.stripeCustomerId = e.stripeFormat;

  const data = {
    customerCode: values.customerCode,
    type: values.type as CustomerType,
    status: values.status as CustomerStatus,
    startDate: values.startDate,
    // only inactive customers have an end date or reasons (enforced in the DB)
    endDate: inactive ? values.endDate : null,
    endReasons: inactive ? reasons : [],
    firstName: values.firstName || null,
    lastName: values.lastName || null,
    companyName: values.companyName || null,
    email: values.email || null,
    referredById,
    billingPropertyId,
    stripeCustomerId: values.stripeCustomerId || null,
    notes: values.notes || null,
  };

  return { data, errors, hasErrors: Object.keys(errors).length > 0 };
}

function dbErrorState(err: unknown, customerCode: string, t: Messages): CustomerFormState {
  const e = t.customers.errors;
  const pg = pgError(err);
  if (pg?.code === "23505" && pg.constraint === "customers_customer_code_key")
    return { errors: { customerCode: e.codeTaken(customerCode) } };
  if (pg?.code === "23505" && pg.constraint === "customers_stripe_customer_id_key")
    return { errors: { stripeCustomerId: e.stripeTaken } };
  if (pg?.code === "23503" && pg.constraint === "customers_billing_property_fkey")
    return { errors: { billingPropertyId: e.billingNotTheirs } };
  if (pg?.code === "23503")
    return { errors: { referredById: e.referrerGone } };
  if (pg?.code === "23514" && pg.constraint === "customers_end_after_start_check")
    return { errors: { endDate: e.endBeforeStart } };
  logError("customer save failed", err);
  return { message: e.saveFailed };
}

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const user = await requireUser();
  const { t, tr } = await getI18n();
  // anyone can add a lead; customers need permission
  if (!can(user, "customers.create")) return { message: tr("You don't have permission to add customers. Add them as a lead instead.") };
  const { data, errors, hasErrors } = parse(formData, t);
  // only people allowed to manage Stripe may link a Stripe customer by hand;
  // everyone else's customers get one created for them below
  if (!can(user, "stripe.manage")) data.stripeCustomerId = null;
  // The first property is optional (leads may not have one yet), but if any
  // of it is filled in, it has to be a complete address.
  const address = readAddress(formData, FIRST_PROPERTY_PREFIX);
  const withProperty = !isAddressBlank(address);
  const propertyErrors = withProperty ? validateAddress(address, t) : {};
  if (hasErrors || Object.keys(propertyErrors).length > 0) return { errors, propertyErrors };

  let id: number;
  try {
    id = await nextId("customers");
    // a new customer's billing address is their first property
    const customer = { ...data, id, billingPropertyId: null };
    if (withProperty) {
      const propertyId = await nextId("properties");
      await db.batch([
        db.insert(customers).values(customer),
        db.insert(properties).values({ id: propertyId, customerId: id, ...addressToRow(address) }),
        db.update(customers).set({ billingPropertyId: propertyId }).where(eq(customers.id, id)),
      ]);
    } else {
      await db.insert(customers).values(customer);
    }
  } catch (err) {
    return dbErrorState(err, data.customerCode, t);
  }

  // Create them in Stripe too, unless a Stripe id was entered to link an
  // existing Stripe customer. The customer is already saved either way; if
  // Stripe fails, their page explains why and offers a retry.
  if (!data.stripeCustomerId && isStripeConfigured()) {
    const result = await createStripeCustomer(id);
    if (!result.ok) redirect(`/customers/${id}?saved=created&stripe=failed`);
  }

  redirect(`/customers/${id}?saved=created`);
}

// A new lead: always the "lead" status, the next customer code, a service
// address and a phone or email. The start date is today for now (the
// database default). They're added to Stripe only when they're
// first invoiced (an accepted estimate, or an invoice made by staff).
export async function createLead(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  await requireUser();
  const { t, tr } = await getI18n();
  const e = t.customers.errors;
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const errors: NonNullable<LeadFormState["errors"]> = {};
  const firstName = get("firstName");
  const lastName = get("lastName");
  const companyName = get("companyName");
  const email = get("email").toLowerCase();
  const rawPhone = get("phone");
  const type = get("type");
  if (!firstName && !companyName) errors.firstName = e.nameRequired;
  if (email && !EMAIL_RE.test(email)) errors.email = e.invalidEmail;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) errors.phone = t.contacts.errors.phone;
  if (!rawPhone && !email) errors.phone = tr("Enter a phone number or an email.");
  if (!(LEAD_TYPES as readonly string[]).includes(type)) errors.type = tr("Choose Residential or Commercial.");
  // the zone is worked out later, so it isn't asked for here
  const address = { ...readAddress(formData, FIRST_PROPERTY_PREFIX), zone: "" };
  const propertyErrors = validateAddress(address, t);
  if (Object.keys(errors).length || Object.keys(propertyErrors).length) return { errors, propertyErrors };

  let id = 0;
  // the next free code; if someone else takes it at the same moment, try the one after
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    try {
      const customerId = await nextId("customers");
      const propertyId = await nextId("properties");
      await db.batch([
        db.insert(customers).values({
          id: customerId,
          customerCode: await getNextCustomerCode(),
          type: type as CustomerType,
          status: "lead",
          firstName: firstName || null,
          lastName: lastName || null,
          companyName: companyName || null,
          email: email || null,
          notes: get("notes") || null,
        }),
        db.insert(properties).values({ id: propertyId, customerId, ...addressToRow(address) }),
        db.update(customers).set({ billingPropertyId: propertyId }).where(eq(customers.id, customerId)),
        ...(phone
          ? [db.insert(contacts).values({ customerId, name: [firstName, lastName].filter(Boolean).join(" ") || companyName || null, phone, isPrimary: true })]
          : []),
      ]);
      id = customerId;
    } catch (err) {
      const pg = pgError(err);
      if (pg?.code === "23505" && pg.constraint === "customers_customer_code_key") continue;
      logError("lead save failed", err);
      return { message: e.saveFailed };
    }
  }
  if (!id) return { message: e.saveFailed };
  redirect(`/customers/${id}?saved=created`);
}

export async function updateCustomer(
  id: number,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const user = await requireUser();
  const { t } = await getI18n();
  const current = await db.query.customers.findFirst({
    columns: {
      status: true,
      customerCode: true,
      firstName: true,
      lastName: true,
      companyName: true,
      email: true,
      billingPropertyId: true,
      stripeCustomerId: true,
      endDate: true,
      endReasons: true,
    },
    where: eq(customers.id, id),
  });
  if (!current) return { message: t.customers.errors.gone };

  const { data, errors, hasErrors } = parse(formData, t, {
    selfId: id,
    previousStatus: current.status,
  });
  if (hasErrors) return { errors };
  // the Stripe link only changes for people allowed to manage Stripe
  if (!can(user, "stripe.manage")) data.stripeCustomerId = current.stripeCustomerId;
  // the customer code and status only for those allowed to change them
  if (!can(user, "customers.editAccount")) Object.assign(data, { customerCode: current.customerCode, status: current.status, endDate: current.endDate, endReasons: current.endReasons });

  try {
    const updated = await db
      .update(customers)
      .set({ ...data, updatedAt: sql`now()` })
      .where(eq(customers.id, id))
      .returning({ id: customers.id });
    if (updated.length === 0) return { message: t.customers.errors.gone };
  } catch (err) {
    return dbErrorState(err, data.customerCode, t);
  }

  // Update Stripe when something it holds changed (name parts, email,
  // billing address, or which Stripe customer this is).
  const stripeFields = ["customerCode", "firstName", "lastName", "companyName", "email", "billingPropertyId", "stripeCustomerId"] as const;
  if (stripeFields.some((f) => current[f] !== data[f])) await syncStripeCustomer(id);

  redirect(`/customers/${id}?saved=updated`);
}

export type StripeActionState = { message?: string };

// "Create in Stripe" on the customer page: for customers added before Stripe
// was connected, or whose automatic creation failed.
export async function syncCustomerToStripe(id: number): Promise<StripeActionState> {
  const access = await checkPermission("stripe.manage");
  if (!access.user) return { message: access.denied };
  const result = await createStripeCustomer(id);
  if (!result.ok) return { message: result.error };
  redirect(`/customers/${id}?stripe=created`);
}

export type DeleteCustomerState = { message?: string };

// Permanently deletes a customer, along with their contacts, properties and
// service plans (cascade), and deletes them in Stripe first. Customers with
// appointment or payment history can't be deleted; mark them inactive.
export async function deleteCustomer(id: number, confirmCode: string): Promise<DeleteCustomerState> {
  const access = await checkPermission("customers.delete");
  if (!access.user) return { message: access.denied };
  const customer = await db.query.customers.findFirst({
    columns: { id: true, customerCode: true, stripeCustomerId: true, status: true },
    where: eq(customers.id, id),
  });
  if (!customer) return { message: "This customer no longer exists." };
  if (confirmCode.trim().toUpperCase() !== customer.customerCode.toUpperCase())
    return { message: `Type ${customer.customerCode} to confirm.` };

  // history that would be lost (or that the database won't let go): their
  // own appointments and payments, and any appointment at their properties
  const theirProperties = db.select({ id: properties.id }).from(properties).where(eq(properties.customerId, id));
  const [[{ visits }], [{ paid }], [{ billed }], [{ quoted }]] = await Promise.all([
    db
      .select({ visits: sql<number>`count(*)::int` })
      .from(appointments)
      .where(or(eq(appointments.customerId, id), inArray(appointments.propertyId, theirProperties))),
    db.select({ paid: sql<number>`count(*)::int` }).from(payments).where(eq(payments.customerId, id)),
    db.select({ billed: sql<number>`count(*)::int` }).from(invoices).where(eq(invoices.customerId, id)),
    db.select({ quoted: sql<number>`count(*)::int` }).from(quotes).where(eq(quotes.customerId, id)),
  ]);
  if (visits > 0 || paid > 0 || billed > 0 || quoted > 0) {
    const parts = [
      visits > 0 && `${visits} ${visits === 1 ? "appointment" : "appointments"}`,
      paid > 0 && `${paid} ${paid === 1 ? "payment" : "payments"}`,
      billed > 0 && `${billed} ${billed === 1 ? "invoice" : "invoices"}`,
      quoted > 0 && `${quoted} ${quoted === 1 ? "estimate" : "estimates"}`,
    ].filter(Boolean);
    return {
      message: `${customer.customerCode} has ${parts.join(" and ")} on record, so they can't be deleted. Mark them inactive instead.`,
    };
  }

  // Stripe first: if it refuses, nothing has been deleted anywhere.
  let stripeNote = "";
  if (customer.stripeCustomerId) {
    if (!isStripeConfigured())
      return { message: "This customer is in Stripe, but Stripe isn't connected, so they can't be deleted there. Nothing was deleted." };
    try {
      await stripe().customers.del(customer.stripeCustomerId);
    } catch (err) {
      // already gone, or from the other Stripe mode (dev holds live-mode ids)
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
        stripeNote = "missing";
      } else {
        logError("stripe customer delete failed", err);
        return { message: `${describeStripeError(err)} Nothing was deleted.` };
      }
    }
  }

  try {
    await db.batch([
      // customers they referred stay, without the referral link
      db.update(customers).set({ referredById: null }).where(eq(customers.referredById, id)),
      db.delete(customers).where(eq(customers.id, id)),
    ]);
  } catch (err) {
    logError("customer delete failed", err);
    // Stripe's copy is already gone; don't leave a dangling id behind
    if (customer.stripeCustomerId && !stripeNote)
      await db.update(customers).set({ stripeCustomerId: null }).where(eq(customers.id, id));
    return { message: "Couldn't delete the customer. Please try again." };
  }

  const stripeResult = !customer.stripeCustomerId ? "none" : stripeNote || "deleted";
  // back to the list they were on
  redirect(`/${customer.status === "lead" ? "leads" : "customers"}?deleted=${encodeURIComponent(customer.customerCode)}&stripe=${stripeResult}`);
}

// "Sync now" on the customer page, after an automatic update failed.
export async function retryStripeSync(id: number): Promise<StripeActionState> {
  const access = await checkPermission("stripe.manage");
  if (!access.user) return { message: access.denied };
  const result = await syncStripeCustomer(id);
  if (result && !result.ok) return { message: result.error };
  redirect(`/customers/${id}?stripe=synced`);
}

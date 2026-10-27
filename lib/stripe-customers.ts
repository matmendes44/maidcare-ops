import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { displayName } from "@/app/(app)/customers/options";
import { describeStripeError, isStripeConfigured, stripe } from "./stripe";
import { logError } from "@/lib/log";

export type StripeSyncResult = { ok: true; stripeCustomerId: string } | { ok: false; error: string };

// Everything Stripe gets about a customer, read fresh from the database:
// name (code first, "C1001 Jane Doe"), email, phone (their primary contact's,
// else the first with a phone), address (billing property), and metadata
// linking the Stripe record back to ours. Contacts themselves stay out of
// Stripe: invoices are billed to the customer account only.
async function loadCustomer(customerId: number) {
  return db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    with: { billingProperty: true, contacts: true },
  });
}

function stripeFields(customer: NonNullable<Awaited<ReturnType<typeof loadCustomer>>>) {
  const billing = customer.billingProperty;
  return {
    name: `${customer.customerCode} ${displayName(customer)}`,
    email: customer.email,
    phone: [...customer.contacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id - b.id).find((c) => c.phone)?.phone ?? null,
    address: billing
      ? {
          line1: billing.street,
          line2: billing.unit ?? "",
          city: billing.city,
          state: billing.state,
          postal_code: billing.zip,
          country: "US",
        }
      : null,
    metadata: { app_customer_id: String(customer.id), customer_code: customer.customerCode },
  };
}

async function recordSyncError(customerId: number, error: string | null) {
  await db.update(customers).set({ stripeSyncError: error }).where(eq(customers.id, customerId));
}

// Creates the Stripe customer for one of our customers and saves its id back
// to customers.stripe_customer_id. Does nothing if they already have one.
export async function createStripeCustomer(customerId: number): Promise<StripeSyncResult> {
  const customer = await loadCustomer(customerId);
  if (!customer) return { ok: false, error: "This customer no longer exists." };
  if (customer.stripeCustomerId) return { ok: true, stripeCustomerId: customer.stripeCustomerId };

  const f = stripeFields(customer);
  let stripeCustomerId: string;
  try {
    const created = await stripe().customers.create(
      {
        name: f.name,
        email: f.email ?? undefined,
        phone: f.phone ?? undefined,
        address: f.address ?? undefined,
        metadata: f.metadata,
      },
      // retries (or a double click) return the same Stripe customer instead
      // of creating a second one
      { idempotencyKey: `maidcare-customer-${customer.id}` },
    );
    stripeCustomerId = created.id;
  } catch (err) {
    logError("stripe customer create failed", err);
    return { ok: false, error: describeStripeError(err) };
  }

  // only fills an empty id, so it never overwrites one set in the meantime
  await db
    .update(customers)
    .set({ stripeCustomerId, stripeSyncError: null })
    .where(and(eq(customers.id, customer.id), isNull(customers.stripeCustomerId)));
  return { ok: true, stripeCustomerId };
}

// Pushes a customer's current details to their Stripe customer. Called after
// every save that changes something Stripe holds (see the list above). A
// failure never undoes the save: it's stored in stripe_sync_error, which the
// customer page shows with a "Sync now" button, and cleared on success.
// Customers without a Stripe id are skipped.
export async function syncStripeCustomer(customerId: number): Promise<StripeSyncResult | null> {
  const customer = await loadCustomer(customerId);
  if (!customer?.stripeCustomerId || !isStripeConfigured()) return null;

  const f = stripeFields(customer);
  try {
    await stripe().customers.update(customer.stripeCustomerId, {
      name: f.name,
      // Email is only ever set, never cleared: many customers have no email
      // in the app while Stripe has the one their invoices go to.
      email: f.email ?? undefined,
      // phone too: only set, so one entered in the Stripe dashboard stays
      phone: f.phone ?? undefined,
      // "" clears the address in Stripe when they no longer have a billing one
      address: f.address ?? "",
      metadata: f.metadata,
    });
  } catch (err) {
    logError("stripe customer sync failed", err);
    const error =
      err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing"
        ? `Stripe has no customer ${customer.stripeCustomerId} (it may have been deleted there, or belong to the other Stripe mode).`
        : describeStripeError(err);
    await recordSyncError(customer.id, error);
    return { ok: false, error };
  }

  if (customer.stripeSyncError) await recordSyncError(customer.id, null);
  return { ok: true, stripeCustomerId: customer.stripeCustomerId };
}

// For saves that can affect several customers at once (a property transfer).
export async function syncStripeCustomers(customerIds: number[]) {
  await Promise.all([...new Set(customerIds)].map((id) => syncStripeCustomer(id)));
}

"use server";

import { and, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { checkPermission } from "@/lib/auth/session";
import { describeStripeError } from "@/lib/stripe";
import { syncStripeCustomer } from "@/lib/stripe-customers";
import { linkInvoicesToCustomer, syncAllInvoices } from "@/lib/stripe-invoices";
import { logError } from "@/lib/log";

export type SyncState = { ok?: string; message?: string };

// "Sync with Stripe": copies every invoice from Stripe into the app.
export async function syncInvoices(): Promise<SyncState> {
  const access = await checkPermission("stripe.manage");
  if (!access.user) return { message: access.denied };
  try {
    const { synced, linked, removed } = await syncAllInvoices();
    refresh();
    const unlinked = synced - linked;
    return {
      ok:
        `Synced ${synced} ${synced === 1 ? "invoice" : "invoices"} from Stripe` +
        (unlinked ? ` (${unlinked} not linked to a customer)` : "") +
        (removed ? `; removed ${removed} deleted ${removed === 1 ? "draft" : "drafts"}` : "") +
        ".",
    };
  } catch (err) {
    logError("invoice sync failed", err);
    return { message: describeStripeError(err) };
  }
}

export type LinkState = { message?: string };

// Links a Stripe customer (seen on an invoice) to one of our customers: saves
// the Stripe id on them, attaches all of that Stripe customer's invoices, and
// brings the Stripe customer's details in line with ours.
export async function linkStripeCustomer(stripeCustomerId: string, customerId: number): Promise<LinkState> {
  const access = await checkPermission("stripe.manage");
  if (!access.user) return { message: access.denied };
  if (!/^cus_\w+$/.test(stripeCustomerId)) return { message: "That isn't a Stripe customer id." };

  const customer = await db.query.customers.findFirst({
    columns: { id: true, customerCode: true, stripeCustomerId: true },
    where: eq(customers.id, customerId),
  });
  if (!customer) return { message: "That customer no longer exists." };
  if (customer.stripeCustomerId && customer.stripeCustomerId !== stripeCustomerId)
    return {
      message: `${customer.customerCode} is already linked to Stripe customer ${customer.stripeCustomerId}. Unlink it there first (clear the Stripe ID on their edit page).`,
    };
  const taken = await db.query.customers.findFirst({
    columns: { customerCode: true },
    where: and(eq(customers.stripeCustomerId, stripeCustomerId), ne(customers.id, customerId)),
  });
  if (taken) return { message: `That Stripe customer is already linked to ${taken.customerCode}.` };

  await db.update(customers).set({ stripeCustomerId }).where(eq(customers.id, customerId));
  await linkInvoicesToCustomer(stripeCustomerId);
  // name ("C1001 Jane Doe"), address and our ids go to Stripe; a failure is
  // shown on the customer's page as usual
  await syncStripeCustomer(customerId);
  refresh();
  return {};
}

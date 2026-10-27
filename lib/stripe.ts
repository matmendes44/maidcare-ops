import "server-only";

import Stripe from "stripe";
import { isDemo } from "@/lib/demo";

// One Stripe client per server process, created on first use.
let client: Stripe | undefined;

export class StripeNotConfiguredError extends Error {
  constructor() {
    super(
      isDemo()
        ? "This is the demo: it isn't connected to Stripe, so charging, finalizing and sending invoices are turned off."
        : "Stripe isn't connected: set STRIPE_SECRET_KEY in .env.local.",
    );
  }
}

// The demo never talks to Stripe, even if a key was set by mistake.
function secretKey() {
  if (isDemo()) return null;
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

export function isStripeConfigured() {
  return secretKey() !== null;
}

// Test/sandbox keys start with sk_test_ (or rk_test_ for restricted keys).
export function isTestMode() {
  return /^(sk|rk)_test_/.test(secretKey() ?? "");
}

export function stripe() {
  const key = secretKey();
  if (!key) throw new StripeNotConfiguredError();
  // Dev runs against a copy of real customer data: never let it charge or
  // create anything in the live Stripe account.
  if (process.env.NODE_ENV !== "production" && !isTestMode()) {
    throw new Error("Outside production only Stripe test/sandbox keys (sk_test_…) are allowed.");
  }
  client ??= new Stripe(key, {
    maxNetworkRetries: 2,
    appInfo: { name: "MaidCare" },
  });
  return client;
}

// Link to an object in the Stripe dashboard, in the mode the key belongs to.
export function stripeDashboardUrl(path: string) {
  return `https://dashboard.stripe.com/${isTestMode() ? "test/" : ""}${path}`;
}

// A short, staff-readable reason for a failed Stripe call.
export function describeStripeError(err: unknown) {
  if (err instanceof StripeNotConfiguredError) return err.message;
  if (err instanceof Stripe.errors.StripeAuthenticationError) return "Stripe rejected the API key. Check STRIPE_SECRET_KEY.";
  if (err instanceof Stripe.errors.StripeConnectionError) return "Couldn't reach Stripe. Check the connection and try again.";
  if (err instanceof Stripe.errors.StripeRateLimitError) return "Stripe is rate-limiting requests. Try again in a moment.";
  if (err instanceof Stripe.errors.StripeIdempotencyError)
    return "Stripe is still processing an earlier attempt for this customer. Try again in a few minutes.";
  if (err instanceof Stripe.errors.StripeError) return `Stripe: ${err.message}`;
  return "Something went wrong talking to Stripe.";
}

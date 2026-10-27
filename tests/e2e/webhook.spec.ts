// Stripe webhook: signed events update invoices; anything unsigned, forged or
// from the other Stripe mode is refused or ignored.
import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import { fixture, fixtures } from "./support/helpers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";

test("Stripe events keep invoices current", async ({ request }) => {
  test.skip(!secret, "STRIPE_WEBHOOK_SECRET isn't set");
  const fx = fixtures();
  const customer = fx.customers.OTHER;
  const send = async (type: string, object: object, opts: { sign?: boolean | string; livemode?: boolean } = {}) => {
    const payload = JSON.stringify({ id: `evt_e2e_${Date.now()}`, object: "event", type, livemode: opts.livemode ?? false, created: Math.floor(Date.now() / 1000), data: { object } });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.sign !== false) headers["stripe-signature"] = stripe.webhooks.generateTestHeaderString({ payload, secret: typeof opts.sign === "string" ? opts.sign : secret });
    const res = await request.post("/api/stripe/webhook", { headers, data: payload });
    return { status: res.status(), body: await res.text() };
  };
  type Local = { status: string; total: number; number: string | null; paidVia: string | null; customerId: number | null } | null;
  const local = (id: string) => fixture<Local>("local", id);

  // made in the Stripe dashboard, not the app
  const inv = await stripe.invoices.create({ customer: customer.stripe, collection_method: "send_invoice", days_until_due: 7, auto_advance: false, pending_invoice_items_behavior: "exclude" });
  await stripe.invoiceItems.create({ customer: customer.stripe, invoice: inv.id, amount: 4200, currency: "usd", description: "Made in Stripe" });

  expect((await send("invoice.created", { id: inv.id }, { sign: false })).status).toBe(400);
  expect((await send("invoice.created", { id: inv.id }, { sign: "whsec_wrong" })).status).toBe(400);
  expect((await send("invoice.created", { id: inv.id }, { livemode: true })).body).toContain("other mode");
  expect(local(inv.id!)).toBeNull();

  // a signed event claiming "paid" can't make it paid: the app asks Stripe
  expect((await send("invoice.paid", { id: inv.id, status: "paid", amount_paid: 999999 })).status).toBe(200);
  expect(local(inv.id!)).toMatchObject({ status: "draft", total: 4200, customerId: customer.id });

  // paid outside the app
  await stripe.invoices.finalizeInvoice(inv.id!, { auto_advance: false });
  await stripe.invoices.pay(inv.id!, { paid_out_of_band: true });
  expect((await send("invoice.paid", { id: inv.id })).status).toBe(200);
  expect(local(inv.id!)).toMatchObject({ status: "paid", paidVia: "outside_stripe" });
  expect(local(inv.id!)?.number).toBeTruthy();

  // a draft deleted in Stripe disappears from the app
  const draft = await stripe.invoices.create({ customer: customer.stripe, collection_method: "send_invoice", days_until_due: 7, auto_advance: false, pending_invoice_items_behavior: "exclude" });
  await send("invoice.created", { id: draft.id });
  expect(local(draft.id!)).not.toBeNull();
  await stripe.invoices.del(draft.id!);
  expect((await send("invoice.deleted", { id: draft.id })).status).toBe(200);
  expect(local(draft.id!)).toBeNull();

  // an event the app can't process gets a 500 so Stripe retries
  expect((await send("invoice.updated", { id: "in_does_not_exist_e2e" })).status).toBe(500);
});

// Service plans → memorized invoices, with real Stripe TEST invoices: the
// latest finalized invoice's lines, the 7-week rule, frequencies, and that a
// second run changes nothing. Nothing is created in Stripe by the import.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "../../db";
import { customers, invoices, memorizedInvoices, properties, servicePlans } from "../../db/schema";
import { applyImport, importCandidates } from "../../lib/recurring/import";

const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
if (!key.startsWith("sk_test_")) throw new Error("Needs a Stripe TEST key.");
const stripe = new Stripe(key);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const ids: Record<string, number> = {};
let stripeCustomer = "";
let otherStripeCustomer = ""; // B's and C's invoices (they aren't linked to Stripe in the app)
const stripeInvoices: string[] = [];
const userId = 0; // no signed-in user here: saved without one

async function finalizedInvoice(lines: [string, number][], customer = stripeCustomer) {
  const inv = await stripe.invoices.create({ customer, collection_method: "send_invoice", days_until_due: 14, auto_advance: false, pending_invoice_items_behavior: "exclude" });
  for (const [i, [description, amount]] of lines.entries())
    await stripe.invoiceItems.create({ customer, invoice: inv.id!, description, amount, currency: "usd", metadata: { position: String(i) } });
  const done = await stripe.invoices.finalizeInvoice(inv.id!, { auto_advance: false });
  stripeInvoices.push(done.id!);
  return done;
}

async function customerWithPlan(code: string, frequency: "biweekly" | "monthly" | "one_time", stripeId: string | null) {
  const [c] = await db.insert(customers).values({ customerCode: code, firstName: "Import", lastName: code, status: "active", stripeCustomerId: stripeId }).returning({ id: customers.id });
  const [p] = await db.insert(properties).values({ customerId: c.id, street: `${code} Plan St`, city: "Baltimore", zip: "21201" }).returning({ id: properties.id });
  const [sp] = await db.insert(servicePlans).values({ propertyId: p.id, frequency, rateCents: 9999, startDate: "2026-01-01" }).returning({ id: servicePlans.id });
  return { customerId: c.id, propertyId: p.id, planId: sp.id };
}

before(async () => {
  stripeCustomer = (await stripe.customers.create({ name: "STRIPETEST import", email: "stripetest-import@example.com" })).id;
  otherStripeCustomer = (await stripe.customers.create({ name: "STRIPETEST import other", email: "stripetest-import2@example.com" })).id;
  // A: linked to Stripe, a recent finalized invoice with two lines
  const a = await customerWithPlan("STRIPETEST19A", "biweekly", stripeCustomer);
  await finalizedInvoice([["Standard cleaning", 18500], ["Inside the fridge", 4500]]);
  // B: not linked; its latest invoice (the app's copy) was 60 days ago
  const b = await customerWithPlan("STRIPETEST19B", "biweekly", null);
  const old = await finalizedInvoice([["Old cleaning", 15000]], otherStripeCustomer);
  // C: not linked, monthly, invoiced 10 days ago
  const c = await customerWithPlan("STRIPETEST19C", "monthly", null);
  const recent = await finalizedInvoice([["Monthly cleaning", 21000]], otherStripeCustomer);
  // D: a one-time plan
  const d = await customerWithPlan("STRIPETEST19D", "one_time", null);
  const row = (stripeInvoiceId: string, customerId: number, at: string, total: number) => ({
    stripeInvoiceId, stripeCustomerId: otherStripeCustomer, customerId, status: "open" as const, currency: "usd", totalCents: total, amountDueCents: total, amountPaidCents: 0, amountRemainingCents: total, createdAt: at, finalizedAt: at,
  });
  await db.insert(invoices).values([row(old.id!, b.customerId, daysAgo(60), 15000), row(recent.id!, c.customerId, daysAgo(10), 21000)]);
  Object.assign(ids, { aPlan: a.planId, aCustomer: a.customerId, bPlan: b.planId, cPlan: c.planId, cCustomer: c.customerId, dPlan: d.planId });
});

after(async () => {
  const mine = await db.select({ id: customers.id }).from(customers).where(like(customers.customerCode, "STRIPETEST19%"));
  await db.delete(invoices).where(inArray(invoices.stripeInvoiceId, stripeInvoices));
  if (mine.length) await db.delete(customers).where(inArray(customers.id, mine.map((c) => c.id)));
  for (const id of stripeInvoices) await stripe.invoices.voidInvoice(id).catch(() => {});
  await stripe.customers.del(stripeCustomer).catch(() => {});
  await stripe.customers.del(otherStripeCustomer).catch(() => {});
});

const ours = async () => (await importCandidates(today)).filter((r) => [ids.aPlan, ids.bPlan, ids.cPlan, ids.dPlan].includes(r.planId));

test("the review: what each plan would become, and why", async () => {
  const rows = await ours();
  const by = (planId: number) => rows.find((r) => r.planId === planId)!;
  const a = by(ids.aPlan);
  assert.equal(a.decision, "create");
  assert.equal(a.frequency, "biweekly");
  assert.equal(a.invoice!.id, null); // not copied into the app yet
  assert.deepEqual(a.lines, [{ description: "Standard cleaning", cents: 18500 }, { description: "Inside the fridge", cents: 4500 }]);
  assert.equal(a.warning, null);
  assert.equal(by(ids.bPlan).decision, "skip");
  assert.match(by(ids.bPlan).reason, /more than 7 weeks ago/);
  assert.equal(by(ids.cPlan).decision, "create");
  assert.equal(by(ids.cPlan).frequency, "monthly");
  assert.equal(by(ids.dPlan).reason, "One-time plan");
});

test("confirming creates the memorized invoices (copying the invoice in), and a second run creates nothing", async () => {
  const r = await applyImport(today, [ids.aPlan, ids.bPlan, ids.cPlan, ids.dPlan], userId);
  assert.deepEqual(r, { created: 2, skipped: 2 });
  const [a] = await db.select().from(memorizedInvoices).where(eq(memorizedInvoices.customerId, ids.aCustomer));
  assert.equal(a.frequency, "biweekly");
  assert.equal(a.totalCents, 23000);
  assert.equal(a.source, "invoice");
  const [copied] = await db.select().from(invoices).where(eq(invoices.id, a.sourceInvoiceId!));
  assert.equal(copied.totalCents, 23000);
  const [c] = await db.select().from(memorizedInvoices).where(eq(memorizedInvoices.customerId, ids.cCustomer));
  assert.equal(c.frequency, "monthly");

  const again = await applyImport(today, [ids.aPlan, ids.cPlan], userId);
  assert.deepEqual(again, { created: 0, skipped: 2 });
  assert.equal((await ours()).find((x) => x.planId === ids.aPlan)!.reason, "Already has a recurring invoice");
});

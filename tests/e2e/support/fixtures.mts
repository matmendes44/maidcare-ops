// Test data for the browser tests (npm run test:e2e). Runs with the dev
// environment; refuses anything that could be production. Everything it
// makes is named STRIPETEST… / …@example.invalid and removed by "cleanup".
//
//   tsx --conditions react-server --env-file=.env.local tests/e2e/support/fixtures.mts <command> [args]
import Stripe from "stripe";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../../../db";
import { appointmentContractors, appointments, contractors, customers, expenses, memorizedInvoices, inventoryAssets, inventoryItems, inventoryLocations, inventoryMovements, inventoryReports, invoices, notifications, properties, recurringExpenses, users, vendors } from "../../../db/schema";
import { hashPassword } from "../../../lib/auth/password";
import { generateSecret } from "../../../lib/auth/totp";
import { sealSecret } from "../../../lib/auth/two-factor";

const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
if (!key.startsWith("sk_test_")) throw new Error("The browser tests need a Stripe TEST key (sk_test_…). Refusing to run.");
if (process.env.VERCEL || process.env.NODE_ENV === "production") throw new Error("Refusing to run test fixtures in production.");
const stripe = new Stripe(key);
const [command, ...args] = process.argv.slice(2);
const out = (v: unknown) => console.log(JSON.stringify(v));
const PASSWORD = "E2eTestPassword123!";
const emailLike = "%@example.invalid";

async function cleanup() {
  // contractors the tests made ("E2E …"); their documents, tax IDs and rates
  // go with them. First, since appointments hold on to customers.
  await db.execute(sql`delete from appointments where customer_id in (select id from customers where customer_code like 'STRIPETEST%')`);
  const testContractors = (await db.select({ id: contractors.id }).from(contractors).where(like(contractors.firstName, "E2E%"))).map((c) => c.id);
  if (testContractors.length) {
    await db.delete(appointmentContractors).where(inArray(appointmentContractors.contractorId, testContractors));
    await db.delete(contractors).where(inArray(contractors.id, testContractors));
  }
  for (const c of await db.select().from(customers).where(like(customers.customerCode, "STRIPETEST%"))) {
    if (c.stripeCustomerId) {
      for (const inv of (await stripe.invoices.list({ customer: c.stripeCustomerId, limit: 100 })).data) {
        if (inv.status === "draft") await stripe.invoices.del(inv.id!).catch(() => {});
        else if (inv.status === "open") await stripe.invoices.voidInvoice(inv.id!).catch(() => {});
      }
      await stripe.customers.del(c.stripeCustomerId).catch(() => {});
    }
    await db.delete(invoices).where(eq(invoices.customerId, c.id));
  }
  for (const cp of (await stripe.coupons.list({ limit: 100 })).data) if (cp.name?.startsWith("STRIPETEST")) await stripe.coupons.del(cp.id).catch(() => {});
  // estimates for test customers. Acceptances are protected by a trigger;
  // test data is the one case where they're removed (dev databases only).
  const testQuotes = (await db.execute(sql`select id from quotes where customer_id in (select id from customers where customer_code like 'STRIPETEST%')`)).rows.map((r) => Number((r as { id: number }).id));
  if (testQuotes.length) {
    await db.execute(sql`delete from notifications where href in ${testQuotes.map((q) => `/finances/estimates/${q}`)}`);
    await db.batch([
      db.execute(sql`alter table quote_acceptances disable trigger quote_acceptances_no_change`),
      db.execute(sql`delete from quote_acceptances where quote_id in ${testQuotes}`),
      db.execute(sql`alter table quote_acceptances enable trigger quote_acceptances_no_change`),
    ]);
    await db.execute(sql`delete from quotes where id in ${testQuotes}`);
  }
  await db.delete(customers).where(like(customers.customerCode, "STRIPETEST%"));
  // leads added through the form ("E2E …"), which get real customer codes
  await db.execute(sql`delete from customers where status = 'lead' and first_name like 'E2E%'`);
  // inventory the tests made ("E2E …"): reports, movements and equipment
  // first (equipment holds on to its expense)
  const testItems = (await db.select({ id: inventoryItems.id }).from(inventoryItems).where(like(inventoryItems.name, "E2E%"))).map((i) => i.id);
  if (testItems.length) {
    const testAssets = (await db.select({ id: inventoryAssets.id }).from(inventoryAssets).where(inArray(inventoryAssets.itemId, testItems))).map((a) => a.id);
    await db.delete(inventoryReports).where(inArray(inventoryReports.itemId, testItems));
    if (testAssets.length) {
      await db.delete(inventoryReports).where(inArray(inventoryReports.assetId, testAssets));
      await db.delete(inventoryAssets).where(inArray(inventoryAssets.id, testAssets));
    }
    await db.delete(inventoryMovements).where(inArray(inventoryMovements.itemId, testItems));
    await db.delete(inventoryItems).where(inArray(inventoryItems.id, testItems));
  }
  await db.execute(sql`delete from notifications where kind = 'expense_edited' and vars->>'vendor' like 'E2E %'`);
  // vendors the expense tests made ("E2E …"), with their expenses
  const testVendors = (await db.select({ id: vendors.id }).from(vendors).where(like(vendors.name, "E2E %"))).map((v) => v.id);
  if (testVendors.length) {
    await db.delete(expenses).where(inArray(expenses.vendorId, testVendors));
    await db.delete(recurringExpenses).where(inArray(recurringExpenses.vendorId, testVendors));
    await db.delete(vendors).where(inArray(vendors.id, testVendors));
  }
  const ids = (await db.select({ id: users.id }).from(users).where(like(users.email, emailLike))).map((u) => u.id);
  if (ids.length) {
    await db.execute(sql`delete from audit_log where changed_by in ${ids}`);
    await db.execute(sql`update invoices set paid_by_user_id = null where paid_by_user_id in ${ids}`);
    // the price list is shared and kept; only who last saved it is cleared
    // (its stamp trigger keeps created_by, so it's paused for this one update)
    await db.batch([
      db.execute(sql`alter table price_lists disable trigger price_lists_stamp`),
      db.execute(sql`update price_lists set created_by = case when created_by in ${ids} then null else created_by end, updated_by = case when updated_by in ${ids} then null else updated_by end`),
      // and any extras a test added ("E2E …")
      db.execute(
        sql`update price_lists set content = jsonb_set(content, '{extras}', (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from jsonb_array_elements(content->'extras') with ordinality t(e, i) where e->>'name' not like 'E2E%')) where content->'extras' @> '[]'::jsonb and exists (select 1 from jsonb_array_elements(content->'extras') e where e->>'name' like 'E2E%')`,
      ),
      db.execute(sql`alter table price_lists enable trigger price_lists_stamp`),
    ]);
    await db.delete(users).where(inArray(users.id, ids));
  }
  await db.execute(sql`delete from login_attempts where email like ${emailLike}`);
}

// a signed-in-ready account: two-step login already set up with a known secret
async function makeUser(email: string, name: string, role: "owner" | "admin" | "staff", enrolled = true) {
  const secret = generateSecret();
  const [u] = await db
    .insert(users)
    .values({
      email,
      name,
      role,
      passwordHash: await hashPassword(PASSWORD),
      ...(enrolled ? { totpSecret: sealSecret(secret), totpEnabledAt: new Date().toISOString() } : {}),
    })
    .returning({ id: users.id });
  return { id: u.id, email, password: PASSWORD, secret: enrolled ? secret : null };
}

async function makeCustomer(code: string, label: string, cards: string[], opts: { credit?: number } = {}) {
  const sc = await stripe.customers.create({ name: `${code} ${label}`, email: `${code.toLowerCase()}@example.com` });
  const pms: string[] = [];
  for (const [i, card] of cards.entries()) {
    const pm = await stripe.paymentMethods.attach(card, { customer: sc.id });
    pms.push(pm.id);
    if (i === 0) await stripe.customers.update(sc.id, { invoice_settings: { default_payment_method: pm.id } });
  }
  if (opts.credit) await stripe.customers.createBalanceTransaction(sc.id, { amount: -opts.credit, currency: "usd", description: "STRIPETEST credit" });
  const [c] = await db
    .insert(customers)
    .values({ customerCode: code, firstName: label, lastName: "Test", email: `${code.toLowerCase()}@example.com`, stripeCustomerId: sc.id })
    .returning({ id: customers.id });
  const [p] = await db.insert(properties).values({ customerId: c.id, street: `${c.id} Test St`, city: "Baltimore", zip: "21201" }).returning({ id: properties.id });
  await db.update(customers).set({ billingPropertyId: p.id }).where(eq(customers.id, c.id));
  return { id: c.id, stripe: sc.id, pms };
}

switch (command) {
  // the QR token of the first active vehicle (or storage) location
  case "location-token": {
    const rows = await db.select({ id: inventoryLocations.id, token: inventoryLocations.reportToken, kind: inventoryLocations.kind, name: inventoryLocations.name }).from(inventoryLocations).where(eq(inventoryLocations.isActive, true));
    const pick = rows.find((r) => r.kind === args[0]) ?? rows[0];
    out(pick);
    break;
  }
  // tries to change an acceptance record: the database should refuse
  case "tamper-acceptance": {
    try {
      await db.execute(sql`update quote_acceptances set total_cents = 1 where quote_id = ${Number(args[0])}`);
      out({ refused: false });
    } catch (err) {
      out({ refused: true, message: String((err as { cause?: { message?: string } }).cause?.message ?? err) });
    }
    break;
  }
  // an open (finalized, unpaid) invoice on a test customer, copied into the
  // app: what a visit is booked against. Prints its app id.
  case "open-invoice": {
    const { syncInvoice } = await import("../../../lib/stripe-invoices");
    const [c] = await db.select().from(customers).where(eq(customers.id, Number(args[0])));
    const inv = await stripe.invoices.create({ customer: c.stripeCustomerId!, collection_method: "send_invoice", days_until_due: 14, auto_advance: false, pending_invoice_items_behavior: "exclude", description: "STRIPETEST visit" });
    await stripe.invoiceItems.create({ customer: c.stripeCustomerId!, invoice: inv.id!, amount: Number(args[1] ?? 15000), currency: "usd", description: "Cleaning" });
    await stripe.invoices.finalizeInvoice(inv.id!, { auto_advance: false });
    out({ id: await syncInvoice(inv.id!) });
    break;
  }
  // a recurring (memorized) invoice on a test customer: $135 every 2 weeks
  // at their billing property (their visits so far set when the next is due)
  case "memorize": {
    const [c] = await db.select().from(customers).where(eq(customers.id, Number(args[0])));
    await db.update(memorizedInvoices).set({ isActive: false }).where(eq(memorizedInvoices.customerId, c.id));
    const [m] = await db
      .insert(memorizedInvoices)
      .values({ customerId: c.id, propertyId: c.billingPropertyId, frequency: "biweekly", lines: [{ description: "STRIPETEST recurring cleaning", cents: 13500 }], totalCents: 13500, source: "invoice" })
      .returning({ id: memorizedInvoices.id });
    out({ id: m.id });
    break;
  }
  case "invoice-number": {
    const [row] = await db.select({ number: invoices.number }).from(invoices).where(eq(invoices.id, Number(args[0])));
    out({ number: row?.number ?? null });
    break;
  }
  // a lead's Stripe customer, made as on their first invoice: what phone it
  // got. The Stripe customer is removed again afterwards.
  case "stripe-phone": {
    const { createStripeCustomer } = await import("../../../lib/stripe-customers");
    const id = Number(args[0]);
    const made = await createStripeCustomer(id);
    if (!made.ok) throw new Error(made.error);
    const sc = await stripe.customers.retrieve(made.stripeCustomerId);
    await stripe.customers.del(made.stripeCustomerId);
    await db.update(customers).set({ stripeCustomerId: null }).where(eq(customers.id, id));
    out({ phone: sc.deleted ? null : sc.phone });
    break;
  }
  case "quote-token": {
    const rows = (await db.execute(sql`select id, public_token as token from quotes where quote_number = ${Number(args[0])}`)).rows;
    out(rows[0] ?? null);
    break;
  }
  case "asset-token": {
    const [a] = await db.select({ id: inventoryAssets.id, token: inventoryAssets.reportToken }).from(inventoryAssets).where(eq(inventoryAssets.assetTag, args[0]));
    out(a ?? null);
    break;
  }
  case "create": {
    await cleanup();
    const owner = await makeUser("e2e-owner@example.invalid", "E2E Owner", "owner");
    const staff = await makeUser("e2e-staff@example.invalid", "E2E Staff", "staff");
    const customersOut = {
      PLAIN: await makeCustomer("STRIPETEST1", "Plain", ["pm_card_visa"]),
      DECLINE: await makeCustomer("STRIPETEST2", "Decline", ["pm_card_chargeCustomerFail", "pm_card_mastercard"]),
      CREDIT: await makeCustomer("STRIPETEST3", "Credit", ["pm_card_visa"], { credit: 2000 }),
      OTHER: await makeCustomer("STRIPETEST4", "Other", ["pm_card_amex"]),
    };
    out({ owner, staff, customers: customersOut });
    break;
  }
  case "user-new": {
    // an account that hasn't set up two-step login yet
    out(await makeUser(args[0], args[1] ?? "E2E New", (args[2] as "staff") ?? "staff", false));
    break;
  }
  case "user": {
    out(
      (await db.query.users.findFirst({
        columns: { id: true, role: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true, isDisabled: true },
        where: eq(users.email, args[0]),
      })) ?? null,
    );
    break;
  }
  case "user-counts": {
    const u = await db.query.users.findFirst({ where: eq(users.email, args[0]) });
    out(
      (
        await db.execute(sql`select (select count(*) from sessions where user_id = ${u!.id})::int sessions,
          (select count(*) from user_recovery_codes where user_id = ${u!.id} and used_at is null)::int codes_left`)
      ).rows[0],
    );
    break;
  }
  case "unlock": {
    await db.execute(sql`delete from login_attempts where email = ${args[0]}`);
    out("ok");
    break;
  }
  case "invoice": {
    // an app invoice in Stripe, and every charge on its customer
    const [row] = await db.select().from(invoices).where(eq(invoices.id, Number(args[0])));
    const inv = await stripe.invoices.retrieve(row.stripeInvoiceId);
    const lines = await stripe.invoices.listLineItems(inv.id!, { limit: 100 });
    const charges = await stripe.charges.list({ customer: row.stripeCustomerId, limit: 100 });
    // every charge on the customer (tests compare by amount)
    const forThis = charges.data;
    out({
      status: inv.status,
      subtotal: inv.subtotal,
      total: inv.total,
      amountPaid: inv.amount_paid,
      amountRemaining: inv.amount_remaining,
      lines: lines.data.map((l) => ({ description: l.description, quantity: l.quantity, amount: l.amount })).reverse(),
      succeeded: forThis.filter((c) => c.status === "succeeded").map((c) => c.amount),
      failed: forThis.filter((c) => c.status === "failed").map((c) => c.amount),
      metadata: inv.metadata ?? {},
      app: { status: row.status, total: row.totalCents, paidVia: row.paidVia, note: row.paidViaNote, paidByUserId: row.paidByUserId },
    });
    break;
  }
  case "stripe-invoices": {
    const [c] = await db.select().from(customers).where(eq(customers.id, Number(args[0])));
    out((await stripe.invoices.list({ customer: c.stripeCustomerId!, limit: 100 })).data.map((i) => ({ id: i.id, status: i.status, total: i.total })));
    break;
  }
  case "customer": {
    const [c] = await db.select({ id: customers.id, stripeCustomerId: customers.stripeCustomerId }).from(customers).where(eq(customers.id, Number(args[0])));
    out(c ?? null);
    break;
  }
  case "local": {
    // the app's own copy of a Stripe invoice
    const [row] = await db.select().from(invoices).where(eq(invoices.stripeInvoiceId, args[0]));
    out(row ? { status: row.status, total: row.totalCents, number: row.number, paidVia: row.paidVia, customerId: row.customerId } : null);
    break;
  }
  case "addline": {
    const [row] = await db.select().from(invoices).where(eq(invoices.id, Number(args[0])));
    await stripe.invoiceItems.create({ customer: row.stripeCustomerId, invoice: row.stripeInvoiceId, amount: Number(args[1]), currency: "usd", description: "Added in Stripe" });
    out("ok");
    break;
  }
  case "void": {
    const [row] = await db.select().from(invoices).where(eq(invoices.id, Number(args[0])));
    await stripe.invoices.voidInvoice(row.stripeInvoiceId);
    out("ok");
    break;
  }
  case "appointment": {
    // a visit for a test customer, `days` from today (negative: in the past), 10–12 Eastern
    const [c] = await db.select({ id: customers.id, propertyId: customers.billingPropertyId }).from(customers).where(eq(customers.id, Number(args[0])));
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + Number(args[1]) * 86_400_000));
    const at = (h: number) => sql`(${day}::date + make_interval(hours => ${h}))::timestamp at time zone 'America/New_York'`;
    const [a] = await db
      .insert(appointments)
      .values({ customerId: c.id, propertyId: c.propertyId!, scheduledStart: at(10) as unknown as string, scheduledEnd: at(12) as unknown as string, priceCents: 15000, status: (args[2] as "pending") ?? "pending" })
      .returning({ id: appointments.id });
    out({ id: a.id, day });
    break;
  }
  case "expense": {
    // a one-time expense to an "E2E …" vendor, added by the user with that email
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, args[1]));
    let [v] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.name, args[0]));
    if (!v) [v] = await db.insert(vendors).values({ vendorCode: `V9${String(Date.now()).slice(-5)}`, name: args[0] }).returning({ id: vendors.id });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const [e] = await db
      .insert(expenses)
      .values({ vendorId: v.id, expenseDate: today, category: "supplies", amountCents: Number(args[2] ?? 2500), paymentMethod: "cash", createdBy: u.id })
      .returning({ id: expenses.id });
    out({ id: e.id });
    break;
  }
  case "locale": {
    // a test user's language ("en-US" or "pt-BR")
    await db.update(users).set({ locale: args[1] as "en-US" }).where(eq(users.email, args[0]));
    out("ok");
    break;
  }
  case "notifications": {
    const rows = await db.select().from(notifications).where(eq(notifications.kind, args[0]));
    out(rows.map((n) => ({ title: n.title, body: n.body, href: n.href, audience: n.audience, vars: n.vars })));
    break;
  }
  case "cleanup":
    await cleanup();
    out("cleaned");
    break;
  default:
    throw new Error(`Unknown command ${command}`);
}

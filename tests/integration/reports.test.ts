// Reports: exact numbers from known records. Everything is placed in March
// 2019, a month with no real data, so totals are exact; global figures
// (outstanding, recurring revenue) are checked by how much they change.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../../db";
import { appointments, customers, invoices, memorizedInvoices, payments, properties } from "../../db/schema";
import * as q from "../../lib/reports/queries";

const MARCH = { from: "2019-03-01", to: "2019-03-31" };
const at = (day: string, hour = 15) => `${day}T${String(hour).padStart(2, "0")}:00:00Z`;
let customerId = 0;
const ids: Record<string, number> = {};
let outstandingBefore: Awaited<ReturnType<typeof q.outstanding>>;
let recurringBefore = 0;

before(async () => {
  outstandingBefore = await q.outstanding();
  recurringBefore = (await q.recurringRevenue()).monthlyCents;
  const [c] = await db
    .insert(customers)
    .values({ customerCode: "STRIPETEST8", firstName: "Reports", lastName: "Test", status: "active", startDate: "2019-03-05" })
    .returning({ id: customers.id });
  customerId = c.id;
  const [p] = await db.insert(properties).values({ customerId, street: "8 Report Rd", city: "Baltimore", zip: "21201" }).returning({ id: properties.id });
  // a recurring (memorized) invoice: $200 every 2 weeks
  await db.insert(memorizedInvoices).values({ customerId, propertyId: p.id, frequency: "biweekly", lines: [{ description: "Cleaning", cents: 20000 }], totalCents: 20000, source: "invoice" });
  const appt = (day: string, price: number, status: "completed" | "canceled", extra = {}) => ({
    customerId, propertyId: p.id, scheduledStart: at(day, 14), scheduledEnd: at(day, 16), priceCents: price, status, ...extra,
  });
  const rows = await db
    .insert(appointments)
    .values([
      // 2 hours on site for $150 -> $75 an hour
      appt("2019-03-06", 15000, "completed", { actualArrival: at("2019-03-06", 14), actualDeparture: at("2019-03-06", 16), actualSource: "manual" }),
      appt("2019-03-13", 15000, "completed"),
      appt("2019-03-20", 12000, "completed"),
      appt("2019-03-27", 15000, "canceled"),
    ])
    .returning({ id: appointments.id });
  [ids.paid, ids.invoiced, ids.unbilled, ids.canceled] = rows.map((r) => r.id);
  // a payment recorded against visit 1, which is also a paid Stripe invoice
  await db.insert(payments).values({ customerId, appointmentId: ids.paid, amountCents: 15000, method: "zelle_personal", stripeInvoiceId: "in_STRIPETEST_dup", paidAt: at("2019-03-08") });
  const invoice = (stripeInvoiceId: string, extra: Partial<typeof invoices.$inferInsert>) => ({
    stripeInvoiceId, stripeCustomerId: "cus_STRIPETEST", customerId, currency: "usd", createdAt: at("2019-03-01"),
    totalCents: 0, amountDueCents: 0, amountPaidCents: 0, amountRemainingCents: 0, status: "draft" as const, ...extra,
  });
  await db.insert(invoices).values([
    // the same money as the payment above: must not be counted twice
    // (and visit 1's invoice: what prices it for revenue per hour)
    invoice("in_STRIPETEST_dup", { status: "paid", totalCents: 15000, amountDueCents: 15000, amountPaidCents: 15000, paidAt: at("2019-03-08"), paidVia: "stripe", appointmentId: ids.paid }),
    // visit 2, paid in cash through an invoice made from it
    invoice("in_STRIPETEST_cash", { status: "paid", totalCents: 8000, amountDueCents: 8000, amountPaidCents: 8000, paidAt: at("2019-03-20"), paidVia: "cash", appointmentId: ids.invoiced, finalizedAt: at("2019-03-14") }),
    // still owed, due long ago
    invoice("in_STRIPETEST_open", { status: "open", totalCents: 10000, amountDueCents: 10000, amountRemainingCents: 10000, dueDate: at("2019-04-01"), finalizedAt: at("2019-03-28") }),
  ]);
});

after(async () => {
  await db.delete(payments).where(eq(payments.customerId, customerId));
  await db.delete(invoices).where(like(invoices.stripeInvoiceId, "in_STRIPETEST_%"));
  await db.delete(appointments).where(eq(appointments.customerId, customerId));
  await db.delete(customers).where(inArray(customers.id, [customerId]));
});

test("collected counts each payment once, including invoices paid outside the payments list", async () => {
  assert.deepEqual(await q.collectedTotal(MARCH), { cents: 23000, payments: 2 });
  assert.deepEqual(await q.collectedByMonth(MARCH), [{ month: "2019-03", cents: 23000 }]);
  const methods = await q.collectedByMethod(MARCH);
  assert.deepEqual(methods.map((m) => [m.method, m.cents]).sort(), [["cash", 8000], ["zelle", 15000]]);
});

test("invoiced counts finalized invoices that are open or paid; visits only count visits", async () => {
  // the cash one (finalized Mar 14) and the open one (Mar 28); the other was never finalized
  assert.deepEqual(await q.invoicedTotal(MARCH), { cents: 18000, invoices: 2 });
  const byStatus = await q.invoicesByStatus(MARCH);
  assert.deepEqual(byStatus.map((x) => [x.status, x.cents, x.count]).sort(), [["open", 10000, 1], ["paid", 23000, 2]]);
  assert.deepEqual(await q.visitCounts(MARCH), { completed: 3, canceled: 1, pending: 0 });
});

test("a completed visit with no payment and no invoice is 'not invoiced'", async () => {
  const r = await q.notInvoiced(MARCH);
  assert.equal(r.count, 1);
  assert.equal(r.list[0].id, ids.unbilled);
  assert.equal("cents" in r, false); // counted, not priced
});

test("outstanding includes the open invoice, in the over-90-days bucket", async () => {
  const now = await q.outstanding();
  assert.equal(now.total - outstandingBefore.total, 10000);
  assert.equal(now.pastDue - outstandingBefore.pastDue, 10000);
  assert.equal(now.aging[4].cents - outstandingBefore.aging[4].cents, 10000);
});

test("revenue per hour on site: the visit's invoice over its real time on site", async () => {
  const r = await q.revenuePerHour(MARCH);
  assert.equal(r.visits, 1);
  assert.equal(r.centsPerHour, 7500);
  assert.equal(r.avgMinutes, 120);
});

test("customers by month count from the start date", async () => {
  const months = await q.customersByMonth(["2019-02", "2019-03"]);
  assert.deepEqual(months.map((m) => [m.month, m.active, m.added, m.lost]), [["2019-02", 0, 0, 0], ["2019-03", 1, 1, 0]]);
});

test("recurring revenue adds each recurring invoice x visits a month", async () => {
  const now = (await q.recurringRevenue()).monthlyCents;
  assert.equal(now - recurringBefore, Math.round((20000 * 365.25) / 12 / 14));
});

test("days to get paid", async () => {
  const r = await q.daysToPaid(MARCH);
  assert.equal(r.invoice.count, 1);
  assert.ok(Math.abs(r.invoice.medianDays! - 6) < 0.01); // finalized Mar 14 -> paid Mar 20, same hour
});

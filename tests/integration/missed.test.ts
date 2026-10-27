// Missed visits: pending well after their end with nobody arriving get one
// notification each, and the dashboard counts what slipped through.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../../db";
import { appointments, customers, notifications, properties } from "../../db/schema";
import { isMissed, missedVisits, notifyMissedVisits } from "../../lib/appointments/missed";

const H = 3600_000;
let customerId = 0;
const ids: Record<string, number> = {};

before(async () => {
  const [c] = await db.insert(customers).values({ customerCode: "STRIPETEST17", firstName: "Missed", lastName: "Test", status: "active" }).returning({ id: customers.id });
  customerId = c.id;
  const [p] = await db.insert(properties).values({ customerId, street: "7 Missed Ln", city: "Baltimore", zip: "21201" }).returning({ id: properties.id });
  const at = (h: number) => new Date(Date.now() + h * H).toISOString();
  const visit = (start: number, extra = {}) => ({ customerId, propertyId: p.id, scheduledStart: at(start), scheduledEnd: at(start + 2), priceCents: 0, ...extra });
  const rows = await db
    .insert(appointments)
    .values([
      visit(-5), // ended 3 hours ago, nobody came: missed
      visit(-5, { actualArrival: at(-5) }), // the crew was there: not missed (just not marked done)
      visit(-2.5), // ended 30 minutes ago: not yet
      visit(-5, { status: "completed" }),
      visit(-24 * 40), // too long ago to chase
    ])
    .returning({ id: appointments.id });
  [ids.missed, ids.arrived, ids.recent, ids.done, ids.old] = rows.map((r) => r.id);
});

after(async () => {
  await db.delete(notifications).where(inArray(notifications.href, Object.values(ids).map((id) => `/appointments/${id}`)));
  await db.delete(appointments).where(eq(appointments.customerId, customerId));
  await db.delete(customers).where(like(customers.customerCode, "STRIPETEST17"));
});

test("only visits nobody arrived at, an hour past their end, count as missed", async () => {
  const mine = (await missedVisits(500)).filter((m) => Object.values(ids).includes(m.id)).map((m) => m.id);
  assert.deepEqual(mine, [ids.missed]);
  const [row] = await db.select().from(appointments).where(eq(appointments.id, ids.missed));
  assert.equal(isMissed(row), true);
});

test("each missed visit is notified once", async () => {
  await notifyMissedVisits();
  await notifyMissedVisits();
  const sent = await db.select().from(notifications).where(eq(notifications.href, `/appointments/${ids.missed}`));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "appointment_missed");
  // stored in English with its values, translated when shown
  assert.equal(sent[0].title, "Missed visit: {name}, {at}");
  assert.match((sent[0].vars as { name: string }).name, /^Missed Test/);
  const others = await db.select().from(notifications).where(inArray(notifications.href, [ids.arrived, ids.recent, ids.done, ids.old].map((id) => `/appointments/${id}`)));
  assert.equal(others.length, 0);
});

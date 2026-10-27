// Expected recurring visits from a memorized invoice, against the dev
// database: timing from the last visit, skips, pauses, and booking ahead.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, like } from "drizzle-orm";
import { db } from "../../db";
import { appointments, customers, memorizedInvoices, memorizedSkips, notifications, properties } from "../../db/schema";
import { expectedVisits } from "../../lib/recurring/expected";
import { notifyRecurringDue } from "../../lib/recurring/alerts";

const H = 3600_000;
const etDay = (daysFromNow: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + daysFromNow * 24 * H));
function et(day: string, time: string) {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(`${day}T12:00:00Z`)).find((p) => p.type === "timeZoneName")!.value.replace("GMT", "");
  return new Date(new Date(`${day}T${time}:00Z`).getTime() - Number(offset || 0) * H).toISOString();
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = etDay(0);
const last = etDay(-8); // the last visit, eight days ago (the next is 6 days out)
let customerId = 0;
let propertyId = 0;
let memorizedId = 0;
const mine = async () => (await expectedVisits(today, addDays(today, 28))).filter((e) => e.customerId === customerId);

before(async () => {
  const [c] = await db.insert(customers).values({ customerCode: "STRIPETEST16", firstName: "Recurring", lastName: "Test", status: "active" }).returning({ id: customers.id });
  customerId = c.id;
  const [p] = await db.insert(properties).values({ customerId, street: "16 Recurring Rd", city: "Baltimore", zip: "21201" }).returning({ id: properties.id });
  propertyId = p.id;
  const [m] = await db
    .insert(memorizedInvoices)
    .values({ customerId, propertyId, frequency: "biweekly", lines: [{ description: "Standard cleaning, every 2 weeks", cents: 27000 }], totalCents: 27000, source: "invoice" })
    .returning({ id: memorizedInvoices.id });
  memorizedId = m.id;
  // booked 10:15–12:15, the crew arrived at 10:23
  await db.insert(appointments).values({ customerId, propertyId, status: "completed", priceCents: 27000, scheduledStart: et(last, "10:15"), scheduledEnd: et(last, "12:15"), actualArrival: et(last, "10:23"), actualSource: "manual" });
});

after(async () => {
  await db.delete(notifications).where(like(notifications.href, `%expected=${memorizedId}`));
  await db.delete(appointments).where(eq(appointments.customerId, customerId));
  await db.delete(customers).where(like(customers.customerCode, "STRIPETEST16"));
});

test("every 2 weeks after the last visit, at its arrival rounded to the half hour, for as long as it was booked", async () => {
  const e = await mine();
  assert.deepEqual(e.map((x) => x.day), [addDays(last, 14), addDays(last, 28)]);
  assert.deepEqual([e[0].start, e[0].end], ["10:30", "12:30"]);
  assert.equal(e[0].totalCents, 27000);
});

test("a visit coming up within a week gets one alert", async () => {
  const href = `/appointments?view=day&date=${addDays(last, 14)}&expected=${memorizedId}`;
  await notifyRecurringDue(today);
  await notifyRecurringDue(today);
  const sent = await db.select().from(notifications).where(eq(notifications.href, href));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, "Recurring visit to book: {name}, {day}");
  assert.match((sent[0].vars as { name: string }).name, /^Recurring Test/);
  assert.equal((sent[0].vars as { day: string }).day, addDays(last, 14));
});

test("skipping one keeps the rhythm", async () => {
  await db.insert(memorizedSkips).values({ memorizedInvoiceId: memorizedId, day: addDays(last, 14) });
  assert.deepEqual((await mine()).map((x) => x.day), [addDays(last, 28)]);
  await db.delete(memorizedSkips).where(eq(memorizedSkips.memorizedInvoiceId, memorizedId));
});

test("booking the next one (on another day) moves the schedule along with it", async () => {
  const booked = addDays(last, 15);
  await db.insert(appointments).values({ customerId, propertyId, status: "pending", priceCents: 0, scheduledStart: et(booked, "09:00"), scheduledEnd: et(booked, "11:00") });
  const e = await mine();
  assert.deepEqual(e.map((x) => x.day), [addDays(booked, 14)].filter((d) => d <= addDays(today, 28)));
  if (e.length) assert.deepEqual([e[0].start, e[0].end], ["09:00", "11:00"]);
});

test("paused or stopped: nothing expected", async () => {
  await db.update(memorizedInvoices).set({ pausedUntil: addDays(today, 60) }).where(eq(memorizedInvoices.id, memorizedId));
  assert.deepEqual(await mine(), []);
  await db.update(memorizedInvoices).set({ pausedUntil: null, isActive: false }).where(eq(memorizedInvoices.id, memorizedId));
  assert.deepEqual(await mine(), []);
});

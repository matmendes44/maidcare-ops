// Arrival/departure detection from Bouncie trips, against the dev database.
// Run with `npm run test:integration` (never against production). Uses its
// own STRIPETEST/TEST records and removes them afterwards.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "../../db";
import { appointmentContractors, appointments, appointmentVehicles, contractors, customers, notifications, properties, vehicles, vehicleTrips, vendors } from "../../db/schema";
import type { BouncieTrip } from "../../lib/bouncie/types";
import { detectVisits, saveTrips } from "../../lib/fleet/sync";

const IMEI = "123450000000001"; // a fake device; real imeis are never touched
const HOME = { lat: 39.2654, lng: -76.5144 };
const SPOT = { lat: 39.3299, lng: -76.6205 };
const H = 3600_000;
// a time today in Eastern time ("13:30" → that instant)
function et(time: string, daysAgo = 0) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() - daysAgo * 24 * H));
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === "timeZoneName")!.value.replace("GMT", "");
  const hours = Number(offset || 0);
  return new Date(`${date}T${time}:00Z`).getTime() - hours * H;
}
const day = et("12:00", 2); // two days ago, at noon Eastern
// two more houses for today's run
const SPOT2 = { lat: 39.2904, lng: -76.6122 };
const SPOT3 = { lat: 39.35, lng: -76.56 };
let vehicleId = 0;
let otherVehicleId = 0;
let propertyId = 0;
const ids: Record<string, number> = {};

const trip = (id: string, from: typeof HOME, to: typeof HOME, start: number, minutes: number): BouncieTrip => ({
  transactionId: `${IMEI}-${id}-test`,
  imei: IMEI,
  startTime: new Date(start).toISOString(),
  endTime: new Date(start + minutes * 60_000).toISOString(),
  distance: 6.2,
  gps: { type: "LineString", coordinates: [[from.lng, from.lat], [(from.lng + to.lng) / 2, (from.lat + to.lat) / 2], [to.lng, to.lat]] },
});

before(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL isn't set");
  const [v] = await db.insert(vehicles).values({ name: "TEST Detection Van", bouncieImei: IMEI }).returning({ id: vehicles.id });
  const [v2] = await db.insert(vehicles).values({ name: "TEST Other Van" }).returning({ id: vehicles.id });
  vehicleId = v.id;
  otherVehicleId = v2.id;
  const [c] = await db.insert(customers).values({ customerCode: "STRIPETEST9", firstName: "Detection", lastName: "Test" }).returning({ id: customers.id });
  const [p] = await db
    .insert(properties)
    .values({ customerId: c.id, street: "9 Detection Way", city: "Baltimore", zip: "21201", lat: SPOT.lat.toFixed(6), lng: SPOT.lng.toFixed(6), geocodeStatus: "found" })
    .returning({ id: properties.id });
  propertyId = p.id;
  const more = await db
    .insert(properties)
    .values([
      { customerId: c.id, street: "10 Detection Way", city: "Baltimore", zip: "21201", lat: SPOT2.lat.toFixed(6), lng: SPOT2.lng.toFixed(6), geocodeStatus: "found" },
      { customerId: c.id, street: "11 Detection Way", city: "Baltimore", zip: "21201", lat: SPOT3.lat.toFixed(6), lng: SPOT3.lng.toFixed(6), geocodeStatus: "found" },
    ])
    .returning({ id: properties.id });
  ids.customer = c.id;
  ids.spot2 = more[0].id;
  ids.spot3 = more[1].id;
  const appt = (vehicle: number, start: number, extra = {}) => ({
    customerId: c.id,
    propertyId,
    vehicleId: vehicle,
    scheduledStart: new Date(start).toISOString(),
    scheduledEnd: new Date(start + 2 * H).toISOString(),
    priceCents: 15000,
    ...extra,
  });
  const rows = await db
    .insert(appointments)
    .values([
      appt(vehicleId, day),
      // times someone typed in must survive
      appt(vehicleId, day - 6 * H, { actualArrival: new Date(day - 6 * H).toISOString(), actualDeparture: new Date(day - 4 * H).toISOString(), actualSource: "manual" }),
      // booked on another van: this van's trips don't count
      appt(otherVehicleId, day + 4 * H),
    ])
    .returning({ id: appointments.id });
  ids.visit = rows[0].id;
  ids.manual = rows[1].id;
  ids.otherVan = rows[2].id;
  // today: booked A (here) 9–11 then B 11–1, but the crew does B first; C 2–4
  const today = await db
    .insert(appointments)
    .values([
      { ...appt(vehicleId, et("09:00")), scheduledEnd: new Date(et("11:00")).toISOString() },
      { ...appt(vehicleId, et("11:00")), propertyId: ids.spot2, scheduledEnd: new Date(et("13:00")).toISOString() },
      { ...appt(vehicleId, et("14:00")), propertyId: ids.spot3, scheduledEnd: new Date(et("16:00")).toISOString() },
    ])
    .returning({ id: appointments.id });
  [ids.todayA, ids.todayB, ids.todayC] = today.map((r) => r.id);
});

after(async () => {
  await db.delete(vehicleTrips).where(eq(vehicleTrips.imei, IMEI));
  const cs = await db.select({ id: customers.id }).from(customers).where(like(customers.customerCode, "STRIPETEST9"));
  if (cs.length) {
    // and any "missed visit" notifications about them
    const visits = await db.select({ id: appointments.id }).from(appointments).where(inArray(appointments.customerId, cs.map((c) => c.id)));
    if (visits.length) await db.delete(notifications).where(inArray(notifications.href, visits.map((v) => `/appointments/${v.id}`)));
    await db.delete(appointments).where(inArray(appointments.customerId, cs.map((c) => c.id)));
  }
  await db.delete(customers).where(like(customers.customerCode, "STRIPETEST9"));
  await db.delete(contractors).where(like(contractors.firstName, "TEST Fleet%"));
  await db.delete(vendors).where(eq(vendors.vendorCode, "V99903"));
  await db.delete(vehicles).where(inArray(vehicles.id, [vehicleId, otherVehicleId, ids.thirdVan ?? 0]));
});

test("trips are matched to the property they start or end at", async () => {
  await saveTrips(
    [
      trip("arrive", HOME, SPOT, day - 30 * 60_000, 20), // ends 10 min before the start
      trip("leave", SPOT, HOME, day + 2 * H + 5 * 60_000, 20), // leaves 5 min after the end
      trip("manual-arrive", HOME, SPOT, day - 6 * H - 20 * 60_000, 15),
      trip("manual-leave", SPOT, HOME, day - 4 * H, 15),
      trip("later", HOME, SPOT, day + 4 * H - 15 * 60_000, 15), // near the other van's visit
    ],
    vehicleId,
    false,
  );
  const saved = await db.select().from(vehicleTrips).where(eq(vehicleTrips.imei, IMEI));
  const byId = (id: string) => saved.find((t) => t.transactionId === `${IMEI}-${id}-test`)!;
  const arrive = byId("arrive");
  assert.equal(arrive.endPropertyId, propertyId);
  assert.equal(arrive.startPropertyId, null);
  assert.equal(byId("leave").startPropertyId, propertyId);
});

test("saving the same trips again doesn't duplicate them", async () => {
  await saveTrips([trip("arrive", HOME, SPOT, day - 30 * 60_000, 20)], vehicleId, false);
  const saved = await db.select().from(vehicleTrips).where(eq(vehicleTrips.imei, IMEI));
  assert.equal(saved.filter((t) => t.transactionId === `${IMEI}-arrive-test`).length, 1);
});

test("a trip still under way is left for a later sync", async () => {
  const ongoing = { ...trip("ongoing", SPOT, HOME, day + 3 * H, 20), endTime: undefined };
  assert.equal(await saveTrips([ongoing, trip("arrive", HOME, SPOT, day - 30 * 60_000, 20)], vehicleId, false), 1);
  const saved = await db.select().from(vehicleTrips).where(eq(vehicleTrips.transactionId, `${IMEI}-ongoing-test`));
  assert.equal(saved.length, 0);
});

test("arrival and departure are detected for the booked van", async () => {
  await detectVisits(new Date(day - 12 * H), new Date(day + 12 * H), "bouncie");
  const [a] = await db.select().from(appointments).where(eq(appointments.id, ids.visit));
  assert.equal(a.actualSource, "gps");
  assert.equal(new Date(a.actualArrival!).getTime(), day - 10 * 60_000);
  assert.equal(new Date(a.actualDeparture!).getTime(), day + 2 * H + 5 * 60_000);
});

test("hand-entered times are never overwritten", async () => {
  const [m] = await db.select().from(appointments).where(eq(appointments.id, ids.manual));
  assert.equal(m.actualSource, "manual");
  assert.equal(new Date(m.actualArrival!).getTime(), day - 6 * H);
});

test("a van that wasn't booked still counts when it's the one that came", async () => {
  // booked on the other van, but this van arrived (and is still there)
  const [o] = await db.select().from(appointments).where(eq(appointments.id, ids.otherVan));
  assert.equal(new Date(o.actualArrival!).getTime(), day + 4 * H);
  assert.equal(o.actualDeparture, null);
  assert.equal(o.status, "in_progress");
});

test("detection is stable when run again", async () => {
  const changed = await detectVisits(new Date(day - 12 * H), new Date(day + 12 * H), "bouncie");
  const [a] = await db.select().from(appointments).where(eq(appointments.id, ids.visit));
  assert.equal(new Date(a.actualArrival!).getTime(), day - 10 * 60_000);
  assert.ok(changed >= 0);
});

test("today: a day done out of order moves each visit to when it really happened", async () => {
  await saveTrips(
    [
      trip("drive-by", HOME, SPOT2, et("06:50"), 10), // a 5-minute stop at B: not the visit
      trip("drive-by-leave", SPOT2, HOME, et("07:05"), 10),
      trip("to-b", HOME, SPOT2, et("08:40"), 20), // B first, at 9:00
      trip("b-to-a", SPOT2, SPOT, et("10:30"), 15), // A at 10:45
      trip("a-to-c", SPOT, SPOT3, et("12:30"), 30), // C at 1:00, still there
    ],
    vehicleId,
    false,
  );
  await detectVisits(new Date(Date.now() - 3 * 24 * H), new Date(Date.now() + 24 * H), "bouncie");
  const get = async (id: number) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
  const t = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

  const b = await get(ids.todayB);
  assert.equal(t(b.actualArrival), et("09:00"));
  assert.equal(t(b.actualDeparture), et("10:30"));
  assert.deepEqual([t(b.scheduledStart), t(b.scheduledEnd)], [et("09:00"), et("10:30")]);
  assert.deepEqual([t(b.bookedStart), t(b.bookedEnd)], [et("11:00"), et("13:00")]); // the booking is kept

  const a = await get(ids.todayA);
  assert.deepEqual([t(a.actualArrival), t(a.actualDeparture)], [et("10:45"), et("12:30")]);
  assert.deepEqual([t(a.scheduledStart), t(a.scheduledEnd)], [et("10:45"), et("12:30")]);

  // still there: starts at the arrival, keeps the booked length
  const c = await get(ids.todayC);
  assert.equal(t(c.actualArrival), et("13:00"));
  assert.equal(c.actualDeparture, null);
  assert.deepEqual([t(c.scheduledStart), t(c.scheduledEnd)], [et("13:00"), et("15:00")]);
});

test("a pending visit a vehicle arrives at becomes in progress; others keep their status", async () => {
  const [c] = await db.select().from(appointments).where(eq(appointments.id, ids.todayC));
  assert.equal(c.status, "in_progress");
  // left, but nobody's on it as the cleaner: waits for Mark completed
  const [v] = await db.select().from(appointments).where(eq(appointments.id, ids.visit));
  assert.equal(v.status, "in_progress");
  // a visit already marked done stays done when detection runs again
  await db.update(appointments).set({ status: "completed" }).where(eq(appointments.id, ids.todayB));
  await detectVisits(new Date(Date.now() - 3 * 24 * H), new Date(Date.now() + 24 * H), "bouncie");
  const [b] = await db.select().from(appointments).where(eq(appointments.id, ids.todayB));
  assert.equal(b.status, "completed");
});

test("other days only get actual times; their schedule isn't moved", async () => {
  const [v] = await db.select().from(appointments).where(eq(appointments.id, ids.visit));
  assert.equal(new Date(v.scheduledStart).getTime(), day);
  assert.equal(v.bookedStart, null);
});

test("times edited by hand after GPS moved them are left alone", async () => {
  await db.update(appointments).set({ scheduledStart: new Date(et("10:50")).toISOString() }).where(eq(appointments.id, ids.todayA));
  await detectVisits(new Date(Date.now() - 3 * 24 * H), new Date(Date.now() + 24 * H), "bouncie");
  const [a] = await db.select().from(appointments).where(eq(appointments.id, ids.todayA));
  assert.equal(new Date(a.scheduledStart).getTime(), et("10:50"));
});

test("two vans at one visit: in progress from the first arrival until the last leaves, then completed with the vans that came", async () => {
  const d = et("12:00", 5);
  const far = { lat: 40.1, lng: -75.5 }; // away from every other test property
  const [vendor] = await db.insert(vendors).values({ vendorCode: "V99903", name: "TEST Fleet Vendor" }).returning({ id: vendors.id });
  const [cleaner] = await db.insert(contractors).values({ vendorId: vendor.id, firstName: "TEST Fleet", lastName: "Cleaner" }).returning({ id: contractors.id });
  const [third] = await db.insert(vehicles).values({ name: "TEST Third Van" }).returning({ id: vehicles.id });
  ids.thirdVan = third.id;
  const [p] = await db
    .insert(properties)
    .values({ customerId: ids.customer, street: "12 Detection Way", city: "Baltimore", zip: "21201", lat: far.lat.toFixed(6), lng: far.lng.toFixed(6), geocodeStatus: "found" })
    .returning({ id: properties.id });
  // booked on the other van, which never shows up
  const [a] = await db
    .insert(appointments)
    .values({ customerId: ids.customer, propertyId: p.id, vehicleId: otherVehicleId, scheduledStart: new Date(d).toISOString(), scheduledEnd: new Date(d + 3 * H).toISOString(), priceCents: 15000 })
    .returning({ id: appointments.id });
  await db.insert(appointmentVehicles).values({ appointmentId: a.id, vehicleId: otherVehicleId });
  await db.insert(appointmentContractors).values({ appointmentId: a.id, contractorId: cleaner.id });

  await saveTrips(
    [
      trip("v1-arrive", HOME, far, d - 30 * 60_000, 20), // there at 11:50
      trip("v1-supplies", far, HOME, d + H, 10), // a supply run…
      trip("v1-back", HOME, far, d + 90 * 60_000, 10), // …back 40 minutes later: still the same visit
    ],
    vehicleId,
    false,
  );
  await saveTrips([trip("v3-arrive", HOME, far, d, 15), trip("v3-leave", far, HOME, d + 2 * H, 20)], third.id, false);
  const detect = () => detectVisits(new Date(d - 12 * H), new Date(d + 12 * H), "bouncie");
  const get = async () => (await db.select().from(appointments).where(eq(appointments.id, a.id)))[0];
  const vans = async () => (await db.select({ id: appointmentVehicles.vehicleId }).from(appointmentVehicles).where(eq(appointmentVehicles.appointmentId, a.id))).map((r) => r.id).sort();

  await detect();
  let v = await get();
  assert.equal(v.status, "in_progress"); // one van has left, the first is still there
  assert.equal(new Date(v.actualArrival!).getTime(), d - 10 * 60_000);
  assert.equal(v.actualDeparture, null);
  assert.deepEqual(await vans(), [otherVehicleId]); // not changed until it's done

  await saveTrips([trip("v1-leave", far, HOME, d + 3 * H, 20)], vehicleId, false);
  await detect();
  v = await get();
  assert.equal(v.status, "completed");
  assert.equal(new Date(v.actualDeparture!).getTime(), d + 3 * H);
  assert.deepEqual(await vans(), [vehicleId, third.id].sort());
  assert.equal(v.vehicleId, vehicleId); // the first to arrive leads

  // changed by hand afterwards: GPS leaves the vehicles alone
  await db.delete(appointmentVehicles).where(and(eq(appointmentVehicles.appointmentId, a.id), eq(appointmentVehicles.vehicleId, third.id)));
  await detect();
  assert.deepEqual(await vans(), [vehicleId]);
});

test("a visit marked completed before the trips came in still gets the vehicle that went", async () => {
  const d = et("12:00", 6);
  const spot = { lat: 40.3, lng: -75.3 }; // away from every other test property
  const [p] = await db
    .insert(properties)
    .values({ customerId: ids.customer, street: "13 Detection Way", city: "Baltimore", zip: "21201", lat: spot.lat.toFixed(6), lng: spot.lng.toFixed(6), geocodeStatus: "found" })
    .returning({ id: properties.id });
  // booked on the other van and already marked done by hand
  const [a] = await db
    .insert(appointments)
    .values({ customerId: ids.customer, propertyId: p.id, vehicleId: otherVehicleId, status: "completed", scheduledStart: new Date(d).toISOString(), scheduledEnd: new Date(d + 2 * H).toISOString(), priceCents: 15000 })
    .returning({ id: appointments.id });
  await db.insert(appointmentVehicles).values({ appointmentId: a.id, vehicleId: otherVehicleId });

  await saveTrips([trip("late-arrive", HOME, spot, d - 20 * 60_000, 15), trip("late-leave", spot, HOME, d + 2 * H, 15)], vehicleId, false);
  await detectVisits(new Date(d - 12 * H), new Date(d + 12 * H), "bouncie");
  const [v] = await db.select().from(appointments).where(eq(appointments.id, a.id));
  assert.equal(v.status, "completed");
  assert.equal(new Date(v.actualArrival!).getTime(), d - 5 * 60_000);
  assert.equal(v.vehicleId, vehicleId);
  const vans = await db.select({ id: appointmentVehicles.vehicleId }).from(appointmentVehicles).where(eq(appointmentVehicles.appointmentId, a.id));
  assert.deepEqual(vans.map((r) => r.id), [vehicleId]);
});


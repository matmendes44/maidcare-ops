import "server-only";

import { and, asc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, properties, vehicles } from "@/db/schema";
import { milesBetween, type Point } from "@/lib/fleet/geo";
import type { BouncieTrip, BouncieVehicle, FleetSource } from "./types";

// DEVELOPMENT ONLY. Made-up but realistic Bouncie data built from the app's
// own schedule, so the Fleet page can be tried before a Bouncie account is
// connected. Like a real account it has its own devices (two vans, which the
// sync adds as vehicles); each drives from a home base to the appointments
// booked on its vehicle that day (arriving a few minutes early, leaving
// around the scheduled end) and back. Everything is deterministic, so the
// same moment always gives the same answer.

// Dundalk, MD, roughly where the business is.
const HOME_BASE: Point = { lat: 39.2654, lng: -76.5144 };
const MPH = 28;

// Fake 15-digit IMEIs start with "99".
export const isSimulatedImei = (imei: string) => /^99\d{13}$/.test(imei);
const DEVICES = [
  { imei: "990000000000001", nickName: "Van 1" },
  { imei: "990000000000002", nickName: "Van 2" },
];

// the app vehicle a simulated device has been added as (by the sync)
async function vehicleIdOf(imei: string) {
  const [v] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.bouncieImei, imei));
  return v?.id ?? null;
}

// a stable pseudo-random number in [0, 1) for a seed
function noise(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

type Stop = Point & { appointmentId: number | null; start: number; end: number };
type Leg = { from: Stop; to: Stop; startAt: number; endAt: number; miles: number };

// The day's driving for one vehicle, from its appointments that day, at the
// times they were booked for (not the ones GPS moved them to, which would
// chase its own tail).
const bookedStart = sql<string>`coalesce(${appointments.bookedStart}, ${appointments.scheduledStart})`;
const bookedEnd = sql<string>`coalesce(${appointments.bookedEnd}, ${appointments.scheduledEnd})`;
async function legsFor(vehicleId: number, dayStart: Date, dayEnd: Date): Promise<Leg[]> {
  const rows = await db
    .select({ id: appointments.id, start: bookedStart, end: bookedEnd, lat: properties.lat, lng: properties.lng })
    .from(appointments)
    .innerJoin(properties, eq(properties.id, appointments.propertyId))
    .where(
      and(
        eq(appointments.vehicleId, vehicleId),
        ne(appointments.status, "canceled"),
        gte(bookedStart, dayStart.toISOString()),
        lt(bookedStart, dayEnd.toISOString()),
        isNotNull(properties.lat),
      ),
    )
    .orderBy(asc(bookedStart));
  if (rows.length === 0) return [];

  const stops: Stop[] = rows.map((r) => ({
    appointmentId: r.id,
    lat: Number(r.lat),
    lng: Number(r.lng),
    start: new Date(r.start).getTime(),
    end: new Date(r.end).getTime(),
  }));
  const base = (at: number): Stop => ({ ...HOME_BASE, appointmentId: null, start: at, end: at });
  const legs: Leg[] = [];
  let previous: Stop = base(0);
  let leaveAt = 0;
  for (const stop of stops) {
    const miles = milesBetween(previous, stop) * 1.35;
    const driveMs = Math.max(6, (miles / MPH) * 60) * 60_000;
    // aim to arrive 5–15 minutes early, but not before leaving the last stop
    const target = stop.start - (5 + noise(stop.appointmentId!) * 10) * 60_000;
    const startAt = Math.max(previous.appointmentId ? leaveAt : target - driveMs, target - driveMs);
    legs.push({ from: previous, to: stop, startAt, endAt: startAt + driveMs, miles });
    // leave within 10 minutes either side of the scheduled end
    leaveAt = Math.max(startAt + driveMs + 20 * 60_000, stop.end + (noise(stop.appointmentId! + 7) * 20 - 10) * 60_000);
    previous = stop;
  }
  const home = base(0);
  const miles = milesBetween(previous, home) * 1.35;
  const driveMs = Math.max(6, (miles / MPH) * 60) * 60_000;
  legs.push({ from: previous, to: home, startAt: leaveAt, endAt: leaveAt + driveMs, miles });
  return legs;
}

// Eastern-time day boundaries around an instant
function easternDay(at: Date) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(at);
  const offset = (d: string) => {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
      .formatToParts(new Date(`${d}T12:00:00Z`))
      .find((p) => p.type === "timeZoneName")!.value;
    return Number(name.replace("GMT", "") || 0);
  };
  const start = new Date(`${day}T00:00:00Z`);
  start.setUTCHours(start.getUTCHours() - offset(day));
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { day, start, end };
}

const odometerBase = (vehicleId: number) => 28_000 + ((vehicleId * 7919) % 30_000);
// about 30 miles a day since the start of the year, so it keeps climbing
const odometerAt = (vehicleId: number, at: number) =>
  odometerBase(vehicleId) + Math.floor((at - Date.UTC(2026, 0, 1)) / 86_400_000) * 30;

function route(from: Point, to: Point): [number, number][] {
  // a gentle bend so routes don't look like ruler lines
  const mid = { lat: (from.lat + to.lat) / 2 + (to.lng - from.lng) * 0.08, lng: (from.lng + to.lng) / 2 - (to.lat - from.lat) * 0.08 };
  const pts: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = { lat: from.lat + (mid.lat - from.lat) * t, lng: from.lng + (mid.lng - from.lng) * t };
    const b = { lat: mid.lat + (to.lat - mid.lat) * t, lng: mid.lng + (to.lng - mid.lng) * t };
    pts.push([+(a.lng + (b.lng - a.lng) * t).toFixed(6), +(a.lat + (b.lat - a.lat) * t).toFixed(6)]);
  }
  return pts;
}

export const simulatedSource: FleetSource = {
  kind: "simulated",

  async vehicles() {
    const now = Date.now();
    const { start, end } = easternDay(new Date(now));
    return Promise.all(
      DEVICES.map(async (device, index): Promise<BouncieVehicle> => {
        const vehicleId = await vehicleIdOf(device.imei);
        const seed = index + 1;
        const legs = vehicleId ? await legsFor(vehicleId, start, end) : [];
        const done = legs.filter((l) => l.endAt <= now);
        const driving = legs.find((l) => l.startAt <= now && now < l.endAt);
        let position: Point = HOME_BASE;
        let speed = 0;
        let heading = 0;
        if (driving) {
          const t = (now - driving.startAt) / (driving.endAt - driving.startAt);
          const path = route(driving.from, driving.to);
          const at = path[Math.min(path.length - 1, Math.floor(t * (path.length - 1)))];
          position = { lng: at[0], lat: at[1] };
          speed = 22 + noise(now / 60_000) * 14;
          heading = (Math.atan2(driving.to.lng - driving.from.lng, driving.to.lat - driving.from.lat) * 180) / Math.PI;
        } else if (done.length) {
          position = done.at(-1)!.to;
        }
        const todayMiles = done.reduce((sum, l) => sum + l.miles, 0) + (driving ? driving.miles * ((now - driving.startAt) / (driving.endAt - driving.startAt)) : 0);
        return {
          imei: device.imei,
          vin: `SIM${String(seed).padStart(14, "0")}`,
          nickName: device.nickName,
          model: { make: "Ford", name: "Transit Connect", year: 2021 },
          stats: {
            odometer: +(odometerAt(seed, start.getTime()) + todayMiles).toFixed(1),
            lastUpdated: new Date(now).toISOString(),
            location: { lat: position.lat, lon: position.lng, heading: (heading + 360) % 360, address: null },
            fuelLevel: Math.round(85 - (todayMiles / 300) * 100 - (seed % 4) * 12),
            isRunning: Boolean(driving),
            speed: Math.round(speed),
            // a check-engine light on the first vehicle and a weak battery on
            // the second, so the health section has something to show
            mil: {
              milOn: index === 0,
              qualifiedDtcList: index === 0 ? [{ code: "P0420", name: ["Catalyst System Efficiency Below Threshold (Bank 1)"] }] : [],
              battery: { status: index === 1 ? "low" : "normal" },
            },
          },
        };
      }),
    );
  },

  async trips(imei, startsAfter, endsBefore) {
    const vehicleId = isSimulatedImei(imei) ? await vehicleIdOf(imei) : null;
    if (!vehicleId) return [];
    const seed = DEVICES.findIndex((d) => d.imei === imei) + 1;
    const now = Date.now();
    const trips: BouncieTrip[] = [];
    // every Eastern day the range touches, the last one included (stepping a
    // whole day from startsAfter skips it when endsBefore is earlier in its day)
    const days = new Map<string, ReturnType<typeof easternDay>>();
    for (let at = startsAfter.getTime(); ; at = Math.min(at + 6 * 3_600_000, endsBefore.getTime())) {
      const d = easternDay(new Date(at));
      days.set(d.day, d);
      if (at >= endsBefore.getTime()) break;
    }
    for (const { start, end } of days.values()) {
      const legs = await legsFor(vehicleId, start, end);
      let odometer = odometerAt(seed, start.getTime());
      for (const leg of legs) {
        const startOdometer = odometer;
        odometer += leg.miles;
        // trips still under way aren't reported yet
        if (leg.endAt > now || leg.startAt < startsAfter.getTime() || leg.endAt > endsBefore.getTime()) continue;
        const minutes = (leg.endAt - leg.startAt) / 60_000;
        trips.push({
          transactionId: `${imei}-${Math.floor(leg.startAt / 1000)}-sim`,
          imei,
          startTime: new Date(leg.startAt).toISOString(),
          endTime: new Date(leg.endAt).toISOString(),
          startOdometer: +startOdometer.toFixed(1),
          endOdometer: +odometer.toFixed(1),
          distance: +leg.miles.toFixed(2),
          fuelConsumed: +(leg.miles / 22).toFixed(2),
          maxSpeed: Math.round(35 + noise(leg.startAt) * 20),
          averageSpeed: Math.round(leg.miles / (minutes / 60)),
          totalIdleDuration: Math.round(noise(leg.startAt + 1) * 240),
          hardBrakingCount: noise(leg.startAt + 2) > 0.85 ? 1 : 0,
          hardAccelerationCount: noise(leg.startAt + 3) > 0.9 ? 1 : 0,
          gps: { type: "LineString", coordinates: route(leg.from, leg.to) },
        });
      }
    }
    return trips;
  },
};

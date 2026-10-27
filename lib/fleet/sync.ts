import "server-only";

import { and, eq, gte, inArray, isNotNull, isNull, like, lt, ne, notInArray, notLike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointmentContractors, appointments, appointmentVehicles, fleetSync, properties, vehicles, vehicleTrips } from "@/db/schema";
import { fleetSource } from "@/lib/bouncie/client";
import { isSimulatedImei } from "@/lib/bouncie/simulator";
import type { BouncieTrip, BouncieVehicle, FleetSource } from "@/lib/bouncie/types";
import { nearest } from "./geo";
import { logError } from "@/lib/log";
import { runScheduleAlerts } from "@/lib/recurring/alerts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// how far back the very first sync reaches, and how much each sync re-reads
// (devices out of signal upload trips late)
const FIRST_SYNC_DAYS = 30;
const OVERLAP = 6 * HOUR;
const MIN_INTERVAL_SECONDS = 45;

export type SyncResult =
  | { status: "synced"; source: FleetSource["kind"]; vehicles: number; trips: number; visits: number }
  | { status: "skipped" | "unavailable" }
  | { status: "failed"; error: string };

// Brings vehicles, trips and detected visits up to date. Runs at most once
// per MIN_INTERVAL_SECONDS (unless forced) and never twice at once: the
// fleet_sync row is leased for a minute while it runs.
export async function syncFleet({ force = false } = {}): Promise<SyncResult> {
  const source = await fleetSource();
  if (!source) return { status: "unavailable" };
  const [lease] = await db
    .update(fleetSync)
    .set({ leaseUntil: sql`now() + interval '60 seconds'` })
    .where(
      and(
        eq(fleetSync.id, 1),
        or(isNull(fleetSync.leaseUntil), lt(fleetSync.leaseUntil, sql`now()`)),
        force
          ? undefined
          : or(isNull(fleetSync.lastSyncedAt), lt(fleetSync.lastSyncedAt, sql`now() - make_interval(secs => ${MIN_INTERVAL_SECONDS})`)),
      ),
    )
    .returning();
  if (!lease) return { status: "skipped" };

  try {
    // switching from the simulator to a real account: drop the made-up data
    if (lease.source && lease.source !== source.kind) await clearSimulated();

    const devices = await source.vehicles();
    const linked = await updateVehicles(devices, source.kind === "simulated");
    const now = new Date();
    const from = lease.tripsSyncedUntil && lease.source === source.kind
      ? new Date(new Date(lease.tripsSyncedUntil).getTime() - OVERLAP)
      : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY);
    let trips = 0;
    for (const v of linked) {
      // the trips endpoint takes at most a week at a time
      for (let start = from.getTime(); start < now.getTime(); start += 7 * DAY) {
        const end = Math.min(start + 7 * DAY, now.getTime());
        trips += await saveTrips(await source.trips(v.imei, new Date(start), new Date(end)), v.id, source.kind === "simulated");
      }
    }
    const visits = await detectVisits(from, now, source.kind);
    // missed visits, recurring visits to book, invoices to finalize
    await runScheduleAlerts(easternDay(now));
    await db
      .update(fleetSync)
      .set({
        source: source.kind,
        lastSyncedAt: now.toISOString(),
        tripsSyncedUntil: now.toISOString(),
        lastError: null,
        leaseUntil: null,
        devices: devices.map((d) => ({
          imei: d.imei,
          nickName: d.nickName ?? null,
          vin: d.vin ?? null,
          model: [d.model?.year, d.model?.make, d.model?.name].filter(Boolean).join(" ") || null,
        })),
      })
      .where(eq(fleetSync.id, 1));
    return { status: "synced", source: source.kind, vehicles: linked.length, trips, visits };
  } catch (err) {
    logError("fleet sync failed", err);
    const error = err instanceof Error ? err.message : "Fleet sync failed.";
    await db.update(fleetSync).set({ lastError: error, leaseUntil: null }).where(eq(fleetSync.id, 1));
    return { status: "failed", error };
  }
}

async function clearSimulated() {
  await db.delete(vehicleTrips).where(eq(vehicleTrips.isSimulated, true));
  await db
    .update(appointments)
    .set({ actualArrival: null, actualDeparture: null, actualSource: null })
    .where(eq(appointments.actualSource, "gps_simulated"));
  // the simulator's vehicles go too (their visits keep no vehicle)
  const fake = await db.select({ id: vehicles.id }).from(vehicles).where(like(vehicles.bouncieImei, "99%"));
  if (fake.length) {
    const ids = fake.map((v) => v.id);
    await db.update(appointments).set({ vehicleId: null }).where(inArray(appointments.vehicleId, ids));
    await db.delete(appointmentVehicles).where(inArray(appointmentVehicles.vehicleId, ids));
    await db.delete(vehicles).where(inArray(vehicles.id, ids));
  }
}

// Bouncie is the list of vehicles: every device on the account is a vehicle
// in the app. A device seen for the first time is linked to an existing
// vehicle with the same name, else added as a new vehicle named after its
// Bouncie nickname (kept in step with it afterwards). Vehicles whose device
// is no longer on the account are marked out of service; they come back if
// it returns. Saves each device's latest readings and returns the devices.
async function updateVehicles(devices: BouncieVehicle[], simulated: boolean) {
  const rows = await db.select().from(vehicles);
  const linked: { id: number; imei: string }[] = [];
  const nameTaken = (name: string, exceptId?: number) =>
    rows.some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === name.trim().toLowerCase());
  const nameFor = (d: BouncieVehicle, exceptId?: number) => {
    const base =
      d.nickName?.trim() || [d.model?.year, d.model?.make, d.model?.name].filter(Boolean).join(" ") || `Vehicle …${d.imei.slice(-4)}`;
    // names are unique; a duplicate nickname gets the device's last digits
    return nameTaken(base, exceptId) ? `${base} (…${d.imei.slice(-4)})` : base;
  };

  for (const d of devices) {
    let v = rows.find((r) => r.bouncieImei === d.imei);
    if (!v && d.nickName) {
      v = rows.find((r) => !r.bouncieImei && r.name.trim().toLowerCase() === d.nickName!.trim().toLowerCase());
    }
    if (!v) {
      const [created] = await db.insert(vehicles).values({ name: nameFor(d), bouncieImei: d.imei }).returning();
      rows.push(created);
      v = created;
    }
    v.bouncieImei = d.imei;
    linked.push({ id: v.id, imei: d.imei });
    const name = d.nickName?.trim() && d.nickName.trim() !== v.name ? nameFor(d, v.id) : v.name;
    v.name = name;
    const s = d.stats ?? {};
    const battery = s.battery?.status ?? s.mil?.battery?.status ?? null;
    await db
      .update(vehicles)
      .set({
        name,
        bouncieImei: d.imei,
        isActive: true,
        vin: d.vin ?? null,
        makeModel: [d.model?.year, d.model?.make, d.model?.name].filter(Boolean).join(" ") || null,
        odometer: s.odometer ?? null,
        fuelLevel: s.fuelLevel ?? null,
        isRunning: s.isRunning ?? null,
        speed: s.speed ?? null,
        location: s.location ? { lat: s.location.lat, lon: s.location.lon, heading: s.location.heading ?? null, address: s.location.address ?? null } : null,
        milOn: s.mil?.milOn ?? null,
        milCodes: s.mil?.qualifiedDtcList?.map((c) => ({ code: c.code, name: c.name?.join("; ") || null })) ?? null,
        batteryStatus: battery,
        statsUpdatedAt: s.lastUpdated ?? new Date().toISOString(),
      })
      .where(eq(vehicles.id, v.id));
  }

  // devices no longer shared by Bouncie: out of service (simulated and real
  // devices are kept apart, so one never retires the other)
  const seen = new Set(devices.map((d) => d.imei));
  const gone = rows.filter((r) => r.bouncieImei && r.isActive && !seen.has(r.bouncieImei) && isSimulatedImei(r.bouncieImei) === simulated);
  if (gone.length) await db.update(vehicles).set({ isActive: false, isRunning: false }).where(inArray(vehicles.id, gone.map((r) => r.id)));
  return linked;
}

// GeoJSON LineString coordinates from a trip's gps field
function routeOf(gps: unknown): [number, number][] | null {
  let g = gps;
  if (typeof g === "string") {
    try {
      g = JSON.parse(g);
    } catch {
      return null;
    }
  }
  const coords = (g as { coordinates?: unknown })?.coordinates;
  if (!Array.isArray(coords)) return null;
  return coords.filter((c): c is [number, number] => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number");
}

async function geocodedProperties() {
  const rows = await db
    .select({ id: properties.id, lat: properties.lat, lng: properties.lng })
    .from(properties)
    .where(isNotNull(properties.lat));
  return rows.map((p) => ({ id: p.id, lat: Number(p.lat), lng: Number(p.lng) }));
}

// Upserts trips (Bouncie may send the same one more than once) with their
// start and end matched to properties. Trips still under way have no end yet
// and are left for a later sync (the overlap re-reads them once they finish).
export async function saveTrips(all: BouncieTrip[], vehicleId: number, simulated: boolean) {
  const trips = all.filter((t): t is BouncieTrip & { endTime: string } => !!t.endTime);
  if (trips.length === 0) return 0;
  const places = await geocodedProperties();
  const rows = trips.map((t) => {
    const route = routeOf(t.gps);
    const first = route?.[0];
    const last = route?.at(-1);
    const start = first ? { lat: first[1], lng: first[0] } : null;
    const end = last ? { lat: last[1], lng: last[0] } : null;
    return {
      transactionId: t.transactionId,
      imei: t.imei,
      vehicleId,
      startAt: t.startTime,
      endAt: t.endTime,
      startOdometer: t.startOdometer ?? null,
      endOdometer: t.endOdometer ?? null,
      distanceMiles: t.distance ?? 0,
      fuelGallons: t.fuelConsumed ?? null,
      maxSpeed: t.maxSpeed ?? null,
      averageSpeed: t.averageSpeed ?? null,
      idleSeconds: t.totalIdleDuration != null ? Math.round(t.totalIdleDuration) : null,
      hardBraking: t.hardBrakingCount ?? null,
      hardAcceleration: t.hardAccelerationCount ?? null,
      startLat: start?.lat ?? null,
      startLng: start?.lng ?? null,
      endLat: end?.lat ?? null,
      endLng: end?.lng ?? null,
      startPropertyId: start ? (nearest(start, places)?.id ?? null) : null,
      endPropertyId: end ? (nearest(end, places)?.id ?? null) : null,
      route,
      isSimulated: simulated,
    };
  });
  await db
    .insert(vehicleTrips)
    .values(rows)
    .onConflictDoUpdate({
      target: vehicleTrips.transactionId,
      set: {
        vehicleId: sql`excluded.vehicle_id`,
        endAt: sql`excluded.end_at`,
        endOdometer: sql`excluded.end_odometer`,
        distanceMiles: sql`excluded.distance_miles`,
        fuelGallons: sql`excluded.fuel_gallons`,
        maxSpeed: sql`excluded.max_speed`,
        averageSpeed: sql`excluded.average_speed`,
        idleSeconds: sql`excluded.idle_seconds`,
        hardBraking: sql`excluded.hard_braking`,
        hardAcceleration: sql`excluded.hard_acceleration`,
        startLat: sql`excluded.start_lat`,
        startLng: sql`excluded.start_lng`,
        endLat: sql`excluded.end_lat`,
        endLng: sql`excluded.end_lng`,
        startPropertyId: sql`excluded.start_property_id`,
        endPropertyId: sql`excluded.end_property_id`,
        route: sql`excluded.route`,
        syncedAt: sql`now()`,
      },
    });
  return rows.length;
}

// Re-matches trips to properties (after addresses were located, or the
// distance that counts as being there changed): every trip, or those since a
// date. Returns how many changed.
export async function rematchTrips(since?: Date) {
  const places = await geocodedProperties();
  const trips = await db
    .select({
      id: vehicleTrips.id,
      startLat: vehicleTrips.startLat,
      startLng: vehicleTrips.startLng,
      endLat: vehicleTrips.endLat,
      endLng: vehicleTrips.endLng,
      startPropertyId: vehicleTrips.startPropertyId,
      endPropertyId: vehicleTrips.endPropertyId,
    })
    .from(vehicleTrips)
    .where(since ? gte(vehicleTrips.endAt, since.toISOString()) : undefined);
  let changed = 0;
  for (const t of trips) {
    const start = t.startLat != null && t.startLng != null ? nearest({ lat: t.startLat, lng: t.startLng }, places)?.id ?? null : null;
    const end = t.endLat != null && t.endLng != null ? nearest({ lat: t.endLat, lng: t.endLng }, places)?.id ?? null : null;
    if (start === t.startPropertyId && end === t.endPropertyId) continue;
    await db.update(vehicleTrips).set({ startPropertyId: start, endPropertyId: end }).where(eq(vehicleTrips.id, t.id));
    changed++;
  }
  return changed;
}

const easternDay = (at: string | number | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(at));
const ms = (iso: string) => new Date(iso).getTime();
// a stop shorter than this is driving past or a quick turn, not the visit
const MIN_STAY = 10 * 60_000;
// back at the house within this long: still the same visit (a supply run,
// moving the van); a vehicle arriving within this long of the last one
// leaving joins the visit too
const RETURN_GAP = 60 * 60_000;

type DetectTrip = {
  transactionId: string;
  vehicleId: number | null;
  startAt: string;
  endAt: string;
  startPropertyId: number | null;
  endPropertyId: number | null;
};
// one vehicle at a property: the trips that brought it there, and the one it
// finally left on (none while it's still there)
type Stay = { vehicleId: number; arrivals: DetectTrip[]; arrivedAt: number; departure: DetectTrip | undefined };

// A vehicle's stays at a property on a day. It has left when a trip starts
// there and ends somewhere else, unless it's back within RETURN_GAP.
function staysOf(mine: DetectTrip[], propertyId: number, day: string, used: Set<string>): Stay[] {
  const isArrival = (t: DetectTrip) => t.endPropertyId === propertyId && !used.has(t.transactionId);
  const stays: Stay[] = [];
  for (const first of mine.filter((t) => isArrival(t) && easternDay(t.endAt) === day)) {
    if (stays.some((s) => s.arrivals.includes(first))) continue;
    // arriving again with no trip away in between (a GPS gap): the same stay
    const during = stays.find((s) => ms(first.endAt) >= s.arrivedAt && (!s.departure || ms(first.endAt) <= ms(s.departure.startAt)));
    if (during) {
      during.arrivals.push(first);
      continue;
    }
    const stay: Stay = { vehicleId: first.vehicleId!, arrivals: [first], arrivedAt: ms(first.endAt), departure: undefined };
    for (let here = ms(first.endAt); ; ) {
      const leave = mine.find((t) => t.startPropertyId === propertyId && t.endPropertyId !== propertyId && ms(t.startAt) >= here && ms(t.startAt) <= here + 12 * HOUR);
      if (!leave) break;
      const back = mine.find((t) => isArrival(t) && ms(t.startAt) >= ms(leave.startAt) && ms(t.endAt) - ms(leave.startAt) <= RETURN_GAP);
      if (!back) {
        stay.departure = leave;
        break;
      }
      stay.arrivals.push(back);
      here = ms(back.endAt);
    }
    if (!stay.departure || ms(stay.departure.startAt) - stay.arrivedAt >= MIN_STAY) stays.push(stay);
  }
  return stays;
}

// Stays grouped into visits: a vehicle arriving while another is there (or
// within RETURN_GAP of it leaving) is part of the same visit.
function groupStays(stays: Stay[]): Stay[][] {
  const groups: Stay[][] = [];
  for (const s of [...stays].sort((a, b) => a.arrivedAt - b.arrivedAt)) {
    const last = groups.at(-1);
    const lastLeft = last && Math.max(...last.map((x) => (x.departure ? ms(x.departure.startAt) : Infinity)));
    if (last && s.arrivedAt <= lastLeft! + RETURN_GAP) last.push(s);
    else groups.push([s]);
  }
  return groups;
}

// Fills in appointments' actual arrival and departure from trips, moves
// today's scheduled times to match, and keeps the status and vehicles in step.
//
// Crews don't always work through the day in the booked order, and vehicles
// get swapped without notice, so a visit is matched to its property for the
// whole day it's booked on, at any hour, by any vehicle: it starts when the
// first vehicle arrives (and stays at least 10 minutes) and ends when the last
// one has left. A vehicle that's back within an hour hasn't left. If vehicles
// came at different times that day, the group with a booked vehicle wins, else
// the first. With two visits at the same property on one day, they take the
// groups in booked order.
//
// Status: a pending visit becomes in progress when the first vehicle arrives,
// and completed when the last one has left (if it says who cleaned; otherwise
// it waits for Mark completed). Completed and canceled visits keep their
// status. A completed visit's vehicles become the ones that came: when it
// becomes completed (here, or by hand: detectVisitsFor), and whenever GPS
// has new times for it (it was marked done before the trips came in, or a
// late vehicle showed up). Edited by hand afterwards, they're left as set.
//
// Only times this detection wrote (actual_source "gps" / "gps_simulated")
// are ever changed: hand-entered or imported times are left alone. On today's
// visits, the scheduled start becomes the arrival and the end the departure
// (or the arrival plus the booked length while they're still there); the
// booked times are kept in booked_start/booked_end. Once someone edits the
// times by hand, GPS stops moving them. Other days only get actual times.
export async function detectVisits(
  from: Date,
  to: Date,
  sourceKind: FleetSource["kind"],
  now = new Date(),
  // just marked completed by hand: also set its vehicles
  completedNow?: number,
) {
  const windowStart = new Date(from.getTime() - DAY);
  const visits = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      propertyId: appointments.propertyId,
      vehicleId: appointments.vehicleId,
      start: appointments.scheduledStart,
      end: appointments.scheduledEnd,
      bookedStart: appointments.bookedStart,
      bookedEnd: appointments.bookedEnd,
      actualArrival: appointments.actualArrival,
      actualDeparture: appointments.actualDeparture,
      actualSource: appointments.actualSource,
    })
    .from(appointments)
    .where(and(ne(appointments.status, "canceled"), gte(appointments.scheduledStart, windowStart.toISOString()), lt(appointments.scheduledStart, to.toISOString())));
  if (visits.length === 0) return 0;
  const ids = visits.map((v) => v.id);
  const [crewVehicles, cleaners] = await Promise.all([
    db
      .select({ appointmentId: appointmentVehicles.appointmentId, vehicleId: appointmentVehicles.vehicleId })
      .from(appointmentVehicles)
      .where(inArray(appointmentVehicles.appointmentId, ids)),
    db
      .selectDistinct({ appointmentId: appointmentContractors.appointmentId })
      .from(appointmentContractors)
      .where(inArray(appointmentContractors.appointmentId, ids)),
  ]);
  const trips: DetectTrip[] = await db
    .select({
      transactionId: vehicleTrips.transactionId,
      vehicleId: vehicleTrips.vehicleId,
      startAt: vehicleTrips.startAt,
      endAt: vehicleTrips.endAt,
      startPropertyId: vehicleTrips.startPropertyId,
      endPropertyId: vehicleTrips.endPropertyId,
    })
    .from(vehicleTrips)
    .where(
      and(
        gte(vehicleTrips.endAt, new Date(windowStart.getTime() - DAY).toISOString()),
        isNotNull(vehicleTrips.vehicleId),
        inArray(vehicleTrips.isSimulated, sourceKind === "simulated" ? [true] : [false]),
        sourceKind === "simulated" ? undefined : notLike(vehicleTrips.imei, "99%"),
      ),
    );
  const byVehicle = new Map<number, DetectTrip[]>();
  for (const t of [...trips].sort((a, b) => ms(a.startAt) - ms(b.startAt))) byVehicle.set(t.vehicleId!, [...(byVehicle.get(t.vehicleId!) ?? []), t]);

  const label = sourceKind === "simulated" ? "gps_simulated" : "gps";
  const today = easternDay(now);
  const used = new Set<string>(); // arrival trips already given to a visit
  let changed = 0;

  // booked order, so two visits at one property on one day take arrivals in turn
  const ordered = [...visits].sort((a, b) => ms(a.bookedStart ?? a.start) - ms(b.bookedStart ?? b.start));
  for (const v of ordered) {
    const day = easternDay(v.bookedStart ?? v.start);
    const booked = crewVehicles.filter((c) => c.appointmentId === v.id).map((c) => c.vehicleId);
    if (v.vehicleId && !booked.includes(v.vehicleId)) booked.push(v.vehicleId);

    const groups = groupStays([...byVehicle.values()].flatMap((mine) => staysOf(mine, v.propertyId, day, used)));
    const stays = groups.find((g) => g.some((s) => booked.includes(s.vehicleId))) ?? groups[0] ?? [];
    for (const s of stays) for (const a of s.arrivals) used.add(a.transactionId);
    // times typed in or imported are left as they are (but still claim their arrival)
    if (v.actualSource && v.actualSource !== "gps" && v.actualSource !== "gps_simulated") continue;
    if (stays.length === 0) continue;

    const arrivedAt = new Date(Math.min(...stays.map((s) => s.arrivedAt))).toISOString();
    // the visit is over when every vehicle that came has left
    const departedAt = stays.every((s) => s.departure) ? new Date(Math.max(...stays.map((s) => ms(s.departure!.startAt)))).toISOString() : null;

    const set: Partial<typeof appointments.$inferInsert> = { actualArrival: arrivedAt, actualDeparture: departedAt, actualSource: label };
    // first vehicle there: under way; last one gone: done (once we know who cleaned)
    let status = v.status;
    if (status === "pending" || status === "in_progress") status = departedAt && cleaners.some((c) => c.appointmentId === v.id) ? "completed" : "in_progress";
    if (status !== v.status) set.status = status;
    // today: the calendar follows what's really happening, unless someone has
    // edited the times by hand since GPS last set them
    const minute = (t: number) => Math.floor(t / 60_000) * 60_000; // the calendar keeps whole minutes
    const gpsOwnsTimes = !v.bookedStart || (v.actualArrival != null && ms(v.start) === minute(ms(v.actualArrival)));
    if (day === today && gpsOwnsTimes) {
      const bookedStart = v.bookedStart ?? v.start;
      const bookedEnd = v.bookedEnd ?? v.end;
      const end = departedAt ? ms(departedAt) : ms(arrivedAt) + (ms(bookedEnd) - ms(bookedStart));
      Object.assign(set, {
        bookedStart,
        bookedEnd,
        scheduledStart: new Date(minute(ms(arrivedAt))).toISOString(),
        scheduledEnd: new Date(Math.max(minute(end), minute(ms(arrivedAt)) + 60_000)).toISOString(),
      });
    }
    // done: the vehicles on it become the ones that came, in order of arrival
    const came = [...new Set([...stays].sort((a, b) => a.arrivedAt - b.arrivedAt).map((s) => s.vehicleId))];
    const same = (a: string | null | undefined, b: string | null | undefined) => (a && b ? ms(a) === ms(b) : !a && !b);
    const newTimes = !same(set.actualArrival, v.actualArrival) || !same(set.actualDeparture, v.actualDeparture) || v.actualSource !== label;
    const justCompleted = set.status === "completed" || (status === "completed" && (newTimes || v.id === completedNow));
    const vehiclesChanged = justCompleted && (came.length !== booked.length || came.some((id) => !booked.includes(id)) || v.vehicleId !== came[0]);
    if (vehiclesChanged) set.vehicleId = came[0];

    if (
      !newTimes &&
      set.status === undefined &&
      !vehiclesChanged &&
      (set.scheduledStart === undefined || (same(set.scheduledStart as string, v.start) && same(set.scheduledEnd as string, v.end)))
    )
      continue;
    const update = db.update(appointments).set(set).where(eq(appointments.id, v.id));
    if (vehiclesChanged)
      await db.batch([
        update,
        db.delete(appointmentVehicles).where(and(eq(appointmentVehicles.appointmentId, v.id), notInArray(appointmentVehicles.vehicleId, came))),
        db.insert(appointmentVehicles).values(came.map((vehicleId) => ({ appointmentId: v.id, vehicleId }))).onConflictDoNothing(),
      ]);
    else await update;
    changed++;
  }
  return changed;
}

// Runs detection for the day of one appointment now (after it's marked
// completed by hand, so its vehicles become the ones that came).
export async function detectVisitsFor(appointmentId: number) {
  const source = await fleetSource();
  if (!source) return;
  const [a] = await db.select({ start: appointments.scheduledStart }).from(appointments).where(eq(appointments.id, appointmentId));
  if (!a) return;
  await detectVisits(new Date(ms(a.start)), new Date(ms(a.start) + DAY), source.kind, new Date(), appointmentId);
}

// For the Bouncie webhooks that report vehicle health between syncs.
export async function recordHealthEvent(
  imei: string,
  event:
    | { type: "mil"; codes: string }
    | { type: "battery"; status: "normal" | "low" | "critical" }
    | { type: "disconnect"; at: string },
) {
  if (isSimulatedImei(imei)) return;
  const set =
    event.type === "mil"
      ? { milOn: true, milCodes: event.codes.split(/[,\s]+/).filter(Boolean).map((code) => ({ code, name: null })) }
      : event.type === "battery"
        ? { batteryStatus: event.status }
        : { unpluggedAt: event.at };
  await db.update(vehicles).set(set).where(eq(vehicles.bouncieImei, imei));
}

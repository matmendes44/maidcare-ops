import "server-only";

import { and, asc, desc, eq, gte, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/lib/db-helpers";
import { appointments, customers, fleetSync, properties, vehicleServiceRecords, vehicles, vehicleTrips } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { fleetSource } from "@/lib/bouncie/client";
import { bouncieConfig, getConnection } from "@/lib/bouncie/tokens";
import { estimatedDriveMinutes, nearest } from "@/lib/fleet/geo";
import { TIME_ZONE } from "@/lib/i18n/config";
import { displayName } from "../customers/options";
import { formatAddress } from "../properties/options";
import { phrase } from "@/lib/i18n/tr";

export const fleetTabs = ["live", "visits", "mileage", "maintenance", "routes", "setup"] as const;
export type FleetTab = (typeof fleetTabs)[number];

const dayRe = /^\d{4}-\d{2}-\d{2}$/;
export const parseDay = (raw: unknown, fallback: string) => (typeof raw === "string" && dayRe.test(raw) ? raw : fallback);
const midnight = (day: string) => sql`(${day}::date::timestamp at time zone ${TIME_ZONE})`;
const nextMidnight = (day: string) => sql`((${day}::date + 1)::timestamp at time zone ${TIME_ZONE})`;

export async function getFleetStatus() {
  await requireUser();
  const [sync, connection, current, pendingLookups, linked, active] = await Promise.all([
    db.query.fleetSync.findFirst({ where: eq(fleetSync.id, 1) }),
    getConnection(),
    // the same rule the sync uses (Bouncie, the simulator, or nothing)
    fleetSource(),
    db.$count(properties, and(isNull(properties.geocodedAt), isNull(properties.lat))),
    db.$count(vehicles, and(isNotNull(vehicles.bouncieImei), eq(vehicles.isActive, true))),
    db.$count(vehicles, eq(vehicles.isActive, true)),
  ]);
  const configured = Boolean(bouncieConfig());
  return {
    source: current?.kind ?? null,
    configured,
    webhookConfigured: Boolean(process.env.BOUNCIE_WEBHOOK_KEY?.trim()),
    connection: connection ? { email: connection.accountEmail, connectedAt: connection.connectedAt } : null,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    lastError: sync?.lastError ?? null,
    devices: sync?.devices ?? [],
    pendingLookups,
    linkedVehicles: linked,
    activeVehicles: active,
  };
}

const appointmentColumns = {
  id: appointments.id,
  status: appointments.status,
  start: appointments.scheduledStart,
  end: appointments.scheduledEnd,
  actualArrival: appointments.actualArrival,
  actualDeparture: appointments.actualDeparture,
  actualSource: appointments.actualSource,
  priceCents: appointments.priceCents,
  vehicleId: appointments.vehicleId,
  vehicleName: vehicles.name,
  customerId: customers.id,
  customerCode: customers.customerCode,
  firstName: customers.firstName,
  lastName: customers.lastName,
  companyName: customers.companyName,
  propertyId: properties.id,
  street: properties.street,
  unit: properties.unit,
  city: properties.city,
  state: properties.state,
  zip: properties.zip,
  lat: properties.lat,
  lng: properties.lng,
};

async function appointmentsOn(day: string) {
  const rows = await db
    .select(appointmentColumns)
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(properties, eq(properties.id, appointments.propertyId))
    .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .where(
      and(
        ne(appointments.status, "canceled"),
        gte(appointments.scheduledStart, sql`${midnight(day)}`),
        lt(appointments.scheduledStart, sql`${nextMidnight(day)}`),
      ),
    )
    .orderBy(asc(appointments.scheduledStart));
  return rows.map((r) => ({
    ...r,
    customer: `${r.customerCode} ${displayName(r)}`,
    address: formatAddress(r),
    point: r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : null,
  }));
}
export type DayAppointment = Awaited<ReturnType<typeof appointmentsOn>>[number];

// Feature 1: where every vehicle is now, and today's stops.
export async function getLive(day: string) {
  await requireUser();
  const [rows, stops, places] = await Promise.all([
    db.select().from(vehicles).where(eq(vehicles.isActive, true)).orderBy(asc(vehicles.name)),
    appointmentsOn(day),
    db
      .select({ id: properties.id, lat: properties.lat, lng: properties.lng, street: properties.street, customerCode: customers.customerCode, firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName })
      .from(properties)
      .innerJoin(customers, eq(customers.id, properties.customerId))
      .where(isNotNull(properties.lat)),
  ]);
  const points = places.map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));
  const fleet = rows.map((v) => {
    const at = v.location ? nearest({ lat: v.location.lat, lng: v.location.lon }, points) : null;
    const next = stops.find((s) => s.vehicleId === v.id && (s.status === "pending" || s.status === "in_progress") && new Date(s.end).getTime() > Date.now());
    return {
      id: v.id,
      name: v.name,
      linked: Boolean(v.bouncieImei),
      location: v.location,
      isRunning: v.isRunning,
      speed: v.speed,
      fuelLevel: v.fuelLevel,
      statsUpdatedAt: v.statsUpdatedAt,
      // no reading for an hour: the device may be offline
      stale: !v.statsUpdatedAt || Date.now() - new Date(v.statsUpdatedAt).getTime() > 3600_000,
      milOn: v.milOn,
      batteryStatus: v.batteryStatus,
      atProperty: !v.isRunning && at ? `${at.customerCode} ${displayName(at)} · ${at.street}` : null,
      next: next ? { customer: next.customer, start: next.start } : null,
    };
  });
  return { fleet, stops };
}

// Features 2 and 4: a day's visits with detected arrival and departure.
export async function getVisits(day: string) {
  await requireUser();
  const rows = await appointmentsOn(day);
  return rows.map((r) => ({
    ...r,
    onSiteMinutes:
      r.actualArrival && r.actualDeparture
        ? Math.round((new Date(r.actualDeparture).getTime() - new Date(r.actualArrival).getTime()) / 60_000)
        : null,
    // left the property but nobody has marked it done yet
    needsCompleting: (r.status === "pending" || r.status === "in_progress") && Boolean(r.actualDeparture),
    lateMinutes: r.actualArrival ? Math.round((new Date(r.actualArrival).getTime() - new Date(r.start).getTime()) / 60_000) : null,
  }));
}

// Feature 5: miles driven per vehicle and day.
export async function getMileage(from: string, to: string) {
  await requireUser();
  // the time zone is written into the query (a fixed constant, not user
  // input) so Postgres sees the same expression in SELECT and GROUP BY
  const localDay = sql<string>`to_char(${vehicleTrips.startAt} at time zone ${sql.raw(`'${TIME_ZONE}'`)}, 'YYYY-MM-DD')`;
  const range = and(gte(vehicleTrips.startAt, sql`${midnight(from)}`), lt(vehicleTrips.startAt, sql`${nextMidnight(to)}`), isNotNull(vehicleTrips.vehicleId));
  const [daily, jobs] = await Promise.all([
    db
      .select({
        day: localDay,
        vehicleId: vehicleTrips.vehicleId,
        vehicleName: vehicles.name,
        trips: sql<number>`count(*)::int`,
        miles: sql<number>`coalesce(sum(${vehicleTrips.distanceMiles}), 0)::float`,
        driveSeconds: sql<number>`coalesce(sum(extract(epoch from ${vehicleTrips.endAt} - ${vehicleTrips.startAt})), 0)::float`,
        fuel: sql<number>`coalesce(sum(${vehicleTrips.fuelGallons}), 0)::float`,
        startOdometer: sql<number | null>`min(${vehicleTrips.startOdometer})`,
        endOdometer: sql<number | null>`max(${vehicleTrips.endOdometer})`,
      })
      .from(vehicleTrips)
      .innerJoin(vehicles, eq(vehicles.id, vehicleTrips.vehicleId))
      .where(range)
      .groupBy(localDay, vehicleTrips.vehicleId, vehicles.name)
      .orderBy(desc(localDay), asc(vehicles.name)),
    // miles of the trip that arrived at each customer's property
    db
      .select({
        customerId: customers.id,
        customerCode: customers.customerCode,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        visits: sql<number>`count(*)::int`,
        miles: sql<number>`sum(${vehicleTrips.distanceMiles})::float`,
      })
      .from(vehicleTrips)
      .innerJoin(properties, eq(properties.id, vehicleTrips.endPropertyId))
      .innerJoin(customers, eq(customers.id, properties.customerId))
      .where(range)
      .groupBy(customers.id)
      .orderBy(desc(sql`sum(${vehicleTrips.distanceMiles})`))
      .limit(15),
  ]);
  const byVehicle = new Map<string, { name: string; miles: number; trips: number; driveSeconds: number; fuel: number }>();
  for (const d of daily) {
    const v = byVehicle.get(d.vehicleName) ?? { name: d.vehicleName, miles: 0, trips: 0, driveSeconds: 0, fuel: 0 };
    v.miles += d.miles;
    v.trips += d.trips;
    v.driveSeconds += d.driveSeconds;
    v.fuel += d.fuel;
    byVehicle.set(d.vehicleName, v);
  }
  return {
    daily,
    totals: [...byVehicle.values()].sort((a, b) => b.miles - a.miles),
    jobs: jobs.map((j) => ({ ...j, customer: `${j.customerCode} ${displayName(j)}` })),
  };
}

// Feature 6: odometer-based service reminders, engine and battery health,
// unplugged devices, and the last 30 days of driving habits.
export async function getMaintenance() {
  await requireUser();
  const [rows, records, habits] = await Promise.all([
    db.select().from(vehicles).where(eq(vehicles.isActive, true)).orderBy(asc(vehicles.name)),
    db.select().from(vehicleServiceRecords).orderBy(desc(vehicleServiceRecords.performedOn), desc(vehicleServiceRecords.id)),
    db
      .select({
        vehicleId: vehicleTrips.vehicleId,
        trips: sql<number>`count(*)::int`,
        miles: sql<number>`coalesce(sum(${vehicleTrips.distanceMiles}), 0)::float`,
        hardBraking: sql<number>`coalesce(sum(${vehicleTrips.hardBraking}), 0)::int`,
        hardAcceleration: sql<number>`coalesce(sum(${vehicleTrips.hardAcceleration}), 0)::int`,
        maxSpeed: sql<number | null>`max(${vehicleTrips.maxSpeed})`,
        idleSeconds: sql<number>`coalesce(sum(${vehicleTrips.idleSeconds}), 0)::int`,
      })
      .from(vehicleTrips)
      .where(gte(vehicleTrips.startAt, sql`now() - interval '30 days'`))
      .groupBy(vehicleTrips.vehicleId),
  ]);
  return rows.map((v) => {
    const history = records.filter((r) => r.vehicleId === v.id);
    const last = history[0] ?? null;
    const dueAt = last ? last.odometer + v.serviceIntervalMiles : null;
    const milesLeft = dueAt != null && v.odometer != null ? Math.round(dueAt - v.odometer) : null;
    return {
      id: v.id,
      name: v.name,
      makeModel: v.makeModel,
      linked: Boolean(v.bouncieImei),
      odometer: v.odometer,
      fuelLevel: v.fuelLevel,
      milOn: v.milOn,
      milCodes: v.milCodes ?? [],
      batteryStatus: v.batteryStatus,
      unpluggedAt: v.unpluggedAt,
      recentlyUnplugged: Boolean(v.unpluggedAt && Date.now() - new Date(v.unpluggedAt).getTime() < 30 * 86_400_000),
      statsUpdatedAt: v.statsUpdatedAt,
      serviceIntervalMiles: v.serviceIntervalMiles,
      lastService: last,
      history: history.slice(0, 5),
      dueAt,
      milesLeft,
      serviceState: (milesLeft == null ? "unknown" : milesLeft < 0 ? "overdue" : milesLeft <= 500 ? "soon" : "ok") as
        | "unknown"
        | "overdue"
        | "soon"
        | "ok",
      habits: habits.find((h) => h.vehicleId === v.id) ?? null,
    };
  });
}

// Feature 8: each vehicle's order of visits for a day, with the time between
// them compared to how long that drive really takes (the median of past
// trips between the two properties), or a distance-based estimate.
export async function getRouteCheck(day: string) {
  await requireUser();
  const [stops, learned] = await Promise.all([
    appointmentsOn(day),
    db
      .select({
        from: vehicleTrips.startPropertyId,
        to: vehicleTrips.endPropertyId,
        minutes: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from ${vehicleTrips.endAt} - ${vehicleTrips.startAt}) / 60)::float`,
        samples: sql<number>`count(*)::int`,
      })
      .from(vehicleTrips)
      .where(and(isNotNull(vehicleTrips.startPropertyId), isNotNull(vehicleTrips.endPropertyId), gte(vehicleTrips.startAt, sql`now() - interval '120 days'`)))
      .groupBy(vehicleTrips.startPropertyId, vehicleTrips.endPropertyId),
  ]);
  const typical = (a: number, b: number) => {
    const both = learned.filter((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
    if (both.length === 0) return null;
    const samples = both.reduce((n, l) => n + l.samples, 0);
    const minutes = both.reduce((sum, l) => sum + l.minutes * l.samples, 0) / samples;
    return { minutes: Math.round(minutes), samples };
  };

  const groups = new Map<string, { vehicle: string; vehicleId: number | null; stops: typeof stops }>();
  for (const s of stops) {
    const key = s.vehicleId ? String(s.vehicleId) : "none";
    const g = groups.get(key) ?? { vehicle: s.vehicleName ?? phrase("No vehicle assigned"), vehicleId: s.vehicleId, stops: [] };
    g.stops.push(s);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    legs: g.stops.slice(1).map((next, i) => {
      const prev = g.stops[i];
      const gapMinutes = Math.round((new Date(next.start).getTime() - new Date(prev.end).getTime()) / 60_000);
      const learnedDrive = typical(prev.propertyId, next.propertyId);
      const drive =
        learnedDrive ??
        (prev.point && next.point ? { minutes: estimatedDriveMinutes(prev.point, next.point), samples: 0 } : null);
      const spare = drive ? gapMinutes - drive.minutes : null;
      return {
        from: prev,
        to: next,
        gapMinutes,
        driveMinutes: drive?.minutes ?? null,
        samples: drive?.samples ?? 0,
        state: (spare == null ? "unknown" : spare < 0 ? "conflict" : spare < 10 ? "tight" : "ok") as "unknown" | "conflict" | "tight" | "ok",
      };
    }),
  }));
}

// Every vehicle, for the Setup tab: those from Bouncie and any added by hand
// before vehicles came from Bouncie (no device).
export async function getVehicleOptions() {
  await requireUser();
  return db
    .select({
      id: vehicles.id,
      name: vehicles.name,
      makeModel: vehicles.makeModel,
      bouncieImei: vehicles.bouncieImei,
      isActive: vehicles.isActive,
      upcoming: sql<number>`(select count(*) from ${appointments} where ${outer(appointments.vehicleId)} = ${outer(vehicles.id)} and ${appointments.status} = 'pending' and ${appointments.scheduledStart} > now())::int`,
    })
    .from(vehicles)
    .orderBy(desc(vehicles.isActive), asc(vehicles.name));
}

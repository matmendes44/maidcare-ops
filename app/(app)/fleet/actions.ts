"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import { appointmentContractors, appointments, appointmentVehicles, fleetSync, vehicles, vehicleServiceRecords, vehicleTrips } from "@/db/schema";
import { requireUser, checkPermission } from "@/lib/auth/session";
import { asUser } from "@/lib/db-helpers";
import { logError } from "@/lib/log";
import { notifyToFinalize } from "@/lib/recurring/alerts";
import { disconnect } from "@/lib/bouncie/tokens";
import { geocodePending } from "@/lib/geocode";
import { detectVisits, detectVisitsFor, rematchTrips, syncFleet } from "@/lib/fleet/sync";
import { fleetSource } from "@/lib/bouncie/client";
import { phrase } from "@/lib/i18n/tr";

export type FleetActionState = { message?: string; ok?: boolean };

const syncMessage = (r: Awaited<ReturnType<typeof syncFleet>>): FleetActionState =>
  r.status === "failed"
    ? { message: r.error }
    : r.status === "unavailable"
      ? { message: phrase("Bouncie isn't connected.") }
      : { ok: true };

// The Refresh button: sync now, even if it synced a moment ago, and re-check
// the last week's trips against the properties (and those visits if any moved).
export async function refreshFleet(): Promise<FleetActionState> {
  await requireUser();
  const result = await syncFleet({ force: true });
  if (result.status === "synced") {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    if ((await rematchTrips(weekAgo)) > 0) await detectVisits(weekAgo, new Date(), result.source);
  }
  refresh();
  return syncMessage(result);
}

// The page's timer while it's open: sync unless it synced in the last minute,
// then re-render either way, since a webhook's sync (or another open tab's)
// may have changed things since the page last loaded.
export async function autoRefreshFleet(): Promise<void> {
  await requireUser();
  await syncFleet();
  refresh();
}

// Looks up addresses that have no coordinates yet, then re-matches trips
// and visits with the new locations.
export async function locateProperties(): Promise<FleetActionState> {
  const access = await checkPermission("fleet.manage");
  if (!access.user) return { message: access.denied };
  const r = await geocodePending(40);
  await rematchTrips();
  const source = await fleetSource();
  if (source) await detectVisits(new Date(Date.now() - 30 * 86_400_000), new Date(), source.kind);
  refresh();
  const parts = [`${r.found} located`];
  if (r.notFound) parts.push(`${r.notFound} not found (check the address)`);
  if (r.failed) parts.push(`${r.failed} couldn't be looked up right now`);
  return { ok: true, message: parts.join(", ") + "." };
}

export async function linkDevice(vehicleId: number, imei: string): Promise<FleetActionState> {
  const access = await checkPermission("fleet.manage");
  if (!access.user) return { message: access.denied };
  const sync = await db.query.fleetSync.findFirst({ where: eq(fleetSync.id, 1) });
  if (imei && !sync?.devices?.some((d) => d.imei === imei)) return { message: phrase("That device isn't on the Bouncie account.") };
  // A device belongs to one vehicle. Giving it to a vehicle that was added by
  // hand merges away the vehicle the sync created for that device: its trips
  // move over, and it's deleted if nothing else refers to it (otherwise it's
  // just retired).
  const previous = imei
    ? await db.query.vehicles.findFirst({ where: and(eq(vehicles.bouncieImei, imei), ne(vehicles.id, vehicleId)) })
    : undefined;
  if (previous) {
    await db.update(vehicles).set({ bouncieImei: null, isActive: false }).where(eq(vehicles.id, previous.id));
    await db.update(vehicleTrips).set({ vehicleId }).where(eq(vehicleTrips.vehicleId, previous.id));
    const [used, alsoOn, services] = await Promise.all([
      db.$count(appointments, eq(appointments.vehicleId, previous.id)),
      db.$count(appointmentVehicles, eq(appointmentVehicles.vehicleId, previous.id)),
      db.$count(vehicleServiceRecords, eq(vehicleServiceRecords.vehicleId, previous.id)),
    ]);
    if (used === 0 && alsoOn === 0 && services === 0) await db.delete(vehicles).where(eq(vehicles.id, previous.id));
  }
  await db.update(vehicles).set({ bouncieImei: imei || null, isActive: true }).where(eq(vehicles.id, vehicleId));
  await syncFleet({ force: true });
  refresh();
  return { ok: true };
}

export async function recordService(vehicleId: number, _prev: FleetActionState, formData: FormData): Promise<FleetActionState> {
  const access = await checkPermission("fleet.service");
  if (!access.user) return { message: access.denied };
  const user = access.user;
  const performedOn = String(formData.get("performedOn") ?? "");
  const odometerRaw = String(formData.get("odometer") ?? "").replace(/[,\s]/g, "");
  const note = String(formData.get("note") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(performedOn)) return { message: phrase("Enter the date of the service.") };
  if (!/^\d{1,7}(\.\d)?$/.test(odometerRaw)) return { message: phrase("Enter the odometer reading, e.g. 48210.") };
  if (note.length > 300) return { message: phrase("Keep the note under 300 characters.") };
  await db.insert(vehicleServiceRecords).values({ vehicleId, performedOn, odometer: Number(odometerRaw), note: note || null, createdBy: user.id });
  refresh();
  return { ok: true, message: phrase("Service recorded.") };
}

export async function setServiceInterval(vehicleId: number, _prev: FleetActionState, formData: FormData): Promise<FleetActionState> {
  const access = await checkPermission("fleet.service");
  if (!access.user) return { message: access.denied };
  const raw = String(formData.get("interval") ?? "").replace(/[,\s]/g, "");
  if (!/^\d{3,6}$/.test(raw) || Number(raw) < 500 || Number(raw) > 50_000) return { message: phrase("Enter a number of miles from 500 to 50,000.") };
  await db.update(vehicles).set({ serviceIntervalMiles: Number(raw) }).where(eq(vehicles.id, vehicleId));
  refresh();
  return { ok: true };
}

// "Mark completed" on a visit the vehicle has already left.
export async function completeVisit(appointmentId: number): Promise<FleetActionState> {
  const access = await checkPermission("appointments.complete");
  if (!access.user) return { message: access.denied };
  const user = access.user;
  // as on the appointment: a completed visit has to say who cleaned it
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(appointmentContractors).where(eq(appointmentContractors.appointmentId, appointmentId));
  if (n === 0) return { message: phrase("Add who cleaned (Edit → Contractors) before marking it completed.") };
  await db.batch([
    asUser(user.id),
    db.update(appointments).set({ status: "completed" }).where(and(eq(appointments.id, appointmentId), inArray(appointments.status, ["pending", "in_progress"]))),
  ]);
  // its vehicles become the ones that came; then the invoice reminder
  await detectVisitsFor(appointmentId).catch((err) => logError("visit detection failed", err));
  await notifyToFinalize().catch((err) => logError("finalize alert failed", err));
  refresh();
  return { ok: true };
}

export async function disconnectBouncie(): Promise<FleetActionState> {
  const access = await checkPermission("fleet.manage");
  if (!access.user) return { message: access.denied };
  await disconnect();
  refresh();
  return { ok: true };
}

import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { vehicleTrips } from "@/db/schema";
import { recordHealthEvent, syncFleet } from "@/lib/fleet/sync";

// room for the retries below
export const maxDuration = 60;
// Bouncie's trips list can lag its tripEnd event by a while, and a trip
// without an end isn't saved yet, so an arrival is checked for a few times
const RETRY_SECONDS = [15, 15, 20];

// Syncs after a trip ended, until that vehicle's finished trip has come in.
async function syncTripEnd(imei: string | null) {
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const arrived = async () =>
    !imei || (await db.select({ id: vehicleTrips.id }).from(vehicleTrips).where(and(eq(vehicleTrips.imei, imei), gte(vehicleTrips.endAt, since))).limit(1)).length > 0;
  await syncFleet({ force: true });
  for (const wait of RETRY_SECONDS) {
    if (await arrived()) return;
    await new Promise((done) => setTimeout(done, wait * 1000));
    await syncFleet({ force: true });
  }
}

// Bouncie pushes vehicle events here (set up on the Bouncie Developer Portal
// with this URL and BOUNCIE_WEBHOOK_KEY as the key). Bouncie sends the key in
// Authorization (and X-Bouncie-Authorization); anything else is refused.
// Answers fast with 200 and does the work afterwards, since Bouncie retries
// slow or failed deliveries and eventually turns the webhook off.
function authorized(request: Request) {
  const expected = process.env.BOUNCIE_WEBHOOK_KEY?.trim();
  if (!expected) return false;
  const given = request.headers.get("x-bouncie-authorization") ?? request.headers.get("authorization") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Event = {
  eventType?: string;
  imei?: string;
  mil?: { codes?: string };
  battery?: { value?: "normal" | "low" | "critical" };
  disconnect?: { timestamp?: string };
};

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let event: Event;
  try {
    event = (await request.json()) as Event;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const imei = typeof event.imei === "string" && /^\d{15}$/.test(event.imei) ? event.imei : null;

  after(async () => {
    switch (event.eventType) {
      // a finished trip may be an arrival: sync now, and again until it's in
      case "tripEnd":
        await syncTripEnd(imei);
        break;
      // the trip before this one may only now be complete (a departure)
      case "tripMetrics":
      case "tripStart":
        await syncFleet({ force: true });
        break;
      case "mil":
        if (imei && event.mil?.codes) await recordHealthEvent(imei, { type: "mil", codes: event.mil.codes });
        break;
      case "battery":
        if (imei && event.battery?.value) await recordHealthEvent(imei, { type: "battery", status: event.battery.value });
        break;
      case "disconnect":
        if (imei) await recordHealthEvent(imei, { type: "disconnect", at: event.disconnect?.timestamp ?? new Date().toISOString() });
        break;
      // tripData (live positions during a trip) is ignored: the map polls
      // the vehicles endpoint instead
    }
  });
  return Response.json({ ok: true });
}

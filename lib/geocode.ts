import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { properties } from "@/db/schema";

// Latitude/longitude for property addresses, from the US Census Bureau's
// free geocoder (no key, US addresses only). Needed to match vehicle trips to
// properties on the Fleet page.
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export async function geocodeAddress(a: { street: string; city: string; state: string; zip: string }) {
  // unit numbers confuse the matcher and don't change the location
  const address = `${a.street}, ${a.city}, ${a.state} ${a.zip}`;
  const url = `${CENSUS}?${new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!res.ok) throw new Error(`Address lookup failed (${res.status}).`);
  const data = (await res.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number } }[] } };
  const match = data.result?.addressMatches?.[0];
  return match ? { lat: match.coordinates.y, lng: match.coordinates.x } : null;
}

// Looks up one property and saves the result ("not_found" when the Census
// doesn't know the address). Network failures leave it to try again later.
export async function geocodeProperty(id: number) {
  const p = await db.query.properties.findFirst({ where: eq(properties.id, id) });
  if (!p) return null;
  const found = await geocodeAddress(p);
  await db
    .update(properties)
    .set({
      lat: found ? found.lat.toFixed(6) : null,
      lng: found ? found.lng.toFixed(6) : null,
      geocodedAt: new Date().toISOString(),
      geocodeStatus: found ? "found" : "not_found",
    })
    .where(eq(properties.id, id));
  return found;
}

// Locates properties that haven't been looked up yet, a few at a time.
export async function geocodePending(limit = 40) {
  const pending = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(isNull(properties.geocodedAt), isNull(properties.lat)))
    .orderBy(asc(properties.id))
    .limit(limit);
  let found = 0;
  let notFound = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += 4) {
    const results = await Promise.allSettled(pending.slice(i, i + 4).map((p) => geocodeProperty(p.id)));
    for (const r of results) {
      if (r.status === "rejected") failed++;
      else if (r.value) found++;
      else notFound++;
    }
  }
  return { found, notFound, failed };
}

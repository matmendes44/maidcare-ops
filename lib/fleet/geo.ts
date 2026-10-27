// Small geometry helpers for GPS points ({ lat, lng } in degrees).

export type Point = { lat: number; lng: number };

const EARTH_METERS = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function metersBetween(a: Point, b: Point) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_METERS * Math.asin(Math.sqrt(h));
}

export const milesBetween = (a: Point, b: Point) => metersBetween(a, b) / 1609.344;

// A trip that starts or ends this close to a property counts as being there:
// GPS and address lookups are each off by tens of meters (more in office
// parks and big complexes), and vans park down the street or in a far lot.
export const AT_PROPERTY_METERS = 500;

export function nearest<T extends Point>(point: Point, candidates: T[], withinMeters = AT_PROPERTY_METERS): T | null {
  let best: T | null = null;
  let bestDistance = withinMeters;
  for (const c of candidates) {
    const d = metersBetween(point, c);
    if (d <= bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

// Rough drive time when there's no trip history between two places: roads
// are ~35% longer than a straight line, at ~25 mph through town.
export function estimatedDriveMinutes(a: Point, b: Point) {
  return Math.max(5, Math.round(((milesBetween(a, b) * 1.35) / 25) * 60));
}

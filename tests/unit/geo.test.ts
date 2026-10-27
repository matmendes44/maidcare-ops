// GPS helpers behind arrival detection and drive-time estimates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AT_PROPERTY_METERS, estimatedDriveMinutes, metersBetween, milesBetween, nearest } from "../../lib/fleet/geo";

const cityHall = { lat: 39.29055, lng: -76.61035 };

test("distances are right", () => {
  // Baltimore City Hall to Fort McHenry is about 4.3 km in a straight line
  const fortMcHenry = { lat: 39.2633, lng: -76.5799 };
  const km = metersBetween(cityHall, fortMcHenry) / 1000;
  assert.ok(km > 3.9 && km < 4.6, String(km));
  assert.ok(Math.abs(milesBetween(cityHall, fortMcHenry) - km / 1.609344) < 0.01);
});

test("a stop counts as at a property only within ~500 m", () => {
  const places = [{ id: 1, ...cityHall }];
  const near = { lat: cityHall.lat + 0.004, lng: cityHall.lng }; // ~445 m north
  const far = { lat: cityHall.lat + 0.006, lng: cityHall.lng }; // ~667 m north
  assert.equal(nearest(near, places)?.id, 1);
  assert.equal(nearest(far, places), null);
  assert.equal(AT_PROPERTY_METERS, 500);
});

test("picks the closest of several properties", () => {
  const places = [
    { id: 1, lat: cityHall.lat + 0.0012, lng: cityHall.lng },
    { id: 2, lat: cityHall.lat + 0.0003, lng: cityHall.lng },
  ];
  assert.equal(nearest(cityHall, places)?.id, 2);
});

test("drive estimates are at least 5 minutes and grow with distance", () => {
  assert.equal(estimatedDriveMinutes(cityHall, cityHall), 5);
  const tenMiles = { lat: cityHall.lat + 0.145, lng: cityHall.lng };
  const minutes = estimatedDriveMinutes(cityHall, tenMiles);
  assert.ok(minutes > 25 && minutes < 40, String(minutes));
});

// Recurring visits: when the next ones are expected, and at what time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedDays, expectedTime, frequencyFromLabel, roundToHalfHour, sameWeekNextMonth } from "../../lib/recurring/schedule";

test("times go to the nearest half hour; exactly between rounds down", () => {
  assert.equal(roundToHalfHour("10:23"), "10:30"); // the crew arrived 10:23
  assert.equal(roundToHalfHour("10:15"), "10:00"); // booked 10:15
  assert.equal(roundToHalfHour("10:45"), "10:30");
  assert.equal(roundToHalfHour("10:46"), "11:00");
  assert.equal(roundToHalfHour("10:14"), "10:00");
  assert.equal(roundToHalfHour("09:00"), "09:00");
  assert.equal(roundToHalfHour("23:59"), "23:30"); // never past the day
});

test("the expected visit keeps the last one's length", () => {
  assert.deepEqual(expectedTime("10:23", 120), { start: "10:30", end: "12:30" });
  assert.deepEqual(expectedTime("13:40", 95), { start: "13:30", end: "15:00" }); // 95 min → 1.5 h
});

test("every interval after the last visit, within the window", () => {
  const w = { from: "2026-10-20", to: "2026-11-17" };
  assert.deepEqual(expectedDays("2026-10-13", "biweekly", w), ["2026-10-27", "2026-11-10"]);
  assert.deepEqual(expectedDays("2026-10-13", "weekly", w), ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10", "2026-11-17"]);
  // a last visit long ago: only the dates from today on
  assert.deepEqual(expectedDays("2026-09-01", "every_4_weeks", w), ["2026-10-27"]);
});

test("a skipped day is left out but the rhythm carries on; a pause hides days", () => {
  const w = { from: "2026-10-20", to: "2026-11-24" };
  assert.deepEqual(expectedDays("2026-10-13", "biweekly", { ...w, skips: new Set(["2026-10-27"]) }), ["2026-11-10", "2026-11-24"]);
  assert.deepEqual(expectedDays("2026-10-13", "weekly", { ...w, pausedUntil: "2026-11-05" }), ["2026-11-10", "2026-11-17", "2026-11-24"]);
});

test("monthly: the same week and weekday of the next month", () => {
  assert.equal(sameWeekNextMonth("2026-10-13"), "2026-11-10"); // 2nd Tuesday → 2nd Tuesday
  assert.equal(sameWeekNextMonth("2026-10-01"), "2026-11-05"); // 1st Thursday → 1st Thursday
  assert.equal(sameWeekNextMonth("2026-10-27"), "2026-11-24"); // 4th Tuesday → 4th Tuesday
  assert.equal(sameWeekNextMonth("2026-10-30"), "2026-11-27"); // 5th Friday → last Friday (no 5th)
  assert.equal(sameWeekNextMonth("2026-12-08"), "2027-01-12"); // across the year: 2nd Tuesday
  assert.equal(sameWeekNextMonth("2027-01-29"), "2027-02-26"); // 5th Friday → last Friday of February
  assert.deepEqual(expectedDays("2026-10-13", "monthly", { from: "2026-10-20", to: "2027-01-31" }), ["2026-11-10", "2026-12-08", "2027-01-12"]);
});

test("an estimate's recurring line names its frequency", () => {
  assert.equal(frequencyFromLabel("Every week"), "weekly");
  assert.equal(frequencyFromLabel("Every 2 weeks"), "biweekly");
  assert.equal(frequencyFromLabel("Every 3 weeks"), "every_3_weeks");
  assert.equal(frequencyFromLabel("Every 4 weeks"), "every_4_weeks");
  assert.equal(frequencyFromLabel("Every month"), "monthly");
  assert.equal(frequencyFromLabel("Every 5 weeks"), null);
});

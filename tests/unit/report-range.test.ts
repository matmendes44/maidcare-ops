// Reports: date ranges, comparisons and recurring-revenue factors.
import assert from "node:assert/strict";
import { test } from "node:test";
import { change, daysIn, monthsBetween, previousRange, resolveRange, visitsPerMonth, weeksBetween } from "../../lib/reports/range";

const today = "2026-10-18";

test("presets", () => {
  assert.deepEqual(resolveRange({ range: "month" }, today), { preset: "month", from: "2026-10-01", to: "2026-10-18" });
  assert.deepEqual(resolveRange({ range: "last-month" }, today), { preset: "last-month", from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(resolveRange({ range: "3m" }, today), { preset: "3m", from: "2026-08-01", to: "2026-10-18" });
  assert.deepEqual(resolveRange({ range: "ytd" }, today), { preset: "ytd", from: "2026-01-01", to: "2026-10-18" });
  assert.deepEqual(resolveRange({}, today), { preset: "12m", from: "2025-11-01", to: "2026-10-18" });
  assert.equal(resolveRange({ range: "nonsense" }, today).preset, "12m");
});

test("last month across a year boundary", () => {
  assert.deepEqual(resolveRange({ range: "last-month" }, "2027-01-10"), { preset: "last-month", from: "2026-12-01", to: "2026-12-31" });
});

test("custom ranges are validated, ordered and end today at the latest", () => {
  assert.deepEqual(resolveRange({ range: "custom", from: "2026-09-10", to: "2026-08-01" }, today), { preset: "custom", from: "2026-08-01", to: "2026-09-10" });
  assert.equal(resolveRange({ range: "custom", from: "2026-09-10", to: "2027-01-01" }, today).to, today);
  assert.equal(resolveRange({ range: "custom", from: "bad", to: "2026-01-01" }, today).preset, "12m");
  assert.equal(resolveRange({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, today).preset, "custom");
});

test("the previous period has the same length, right before", () => {
  const r = { from: "2026-10-01", to: "2026-10-18" };
  const p = previousRange(r);
  assert.deepEqual(p, { from: "2026-09-13", to: "2026-09-30" });
  assert.equal(daysIn(p), daysIn(r));
});

test("month and week lists", () => {
  assert.deepEqual(monthsBetween("2026-08-15", "2026-10-02"), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(weeksBetween("2026-10-01", "2026-10-18"), ["2026-09-28", "2026-10-05", "2026-10-12"]);
});

test("percent change", () => {
  assert.equal(change(150, 100), 0.5);
  assert.equal(change(50, 100), -0.5);
  assert.equal(change(10, 0), null);
});

test("recurring revenue factors", () => {
  assert.equal(visitsPerMonth.monthly, 1);
  assert.ok(Math.abs(visitsPerMonth.biweekly - 2.1667) < 0.001);
  assert.equal(visitsPerMonth.one_time, 0);
});

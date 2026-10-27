// Inventory math: statuses, reorder suggestions, counts, service and value.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookValue, countResult, daysLeft, reorder, serviceDue, stockStatus } from "../../lib/inventory/stock";

test("stock is out at zero and low at or under the reorder point", () => {
  assert.equal(stockStatus(0, 5), "out");
  assert.equal(stockStatus(-1, 5), "out");
  assert.equal(stockStatus(5, 5), "low");
  assert.equal(stockStatus(6, 5), "ok");
  assert.equal(stockStatus(1, 0), "ok"); // no reorder point set
});

test("days of stock left at the recent rate", () => {
  assert.equal(daysLeft(30, 2), 15);
  assert.equal(daysLeft(5, 2), 2);
  assert.equal(daysLeft(10, 0), null);
});

test("reorder when storage is low or stock runs out within the lead time", () => {
  assert.equal(reorder({ totalOnHand: 50, storageOnHand: 40, reorderPoint: 10, reorderQuantity: 24, perDay: 1 }), null);
  const low = reorder({ totalOnHand: 20, storageOnHand: 8, reorderPoint: 10, reorderQuantity: 24, perDay: 0.5 })!;
  assert.deepEqual(low.reasons, ["low in storage"]);
  assert.equal(low.quantity, 24);
  // using 3 a day with 12 on hand: 4 days left; buy 30 days' worth minus what's on hand
  const fast = reorder({ totalOnHand: 12, storageOnHand: 12, reorderPoint: 0, reorderQuantity: 10, perDay: 3 })!;
  assert.match(fast.reasons[0], /runs out in about 4 days/);
  assert.equal(fast.quantity, 90 - 12);
  assert.deepEqual(reorder({ totalOnHand: 0, storageOnHand: 0, reorderPoint: 2, reorderQuantity: 0, perDay: 0 })!.reasons, ["out in storage"]);
});

test("a count: short supplies were used, short reusables written off, extras found; vehicles load back to par", () => {
  assert.deepEqual(countResult("supply", 6, 2, 6), { used: 4, writtenOff: 0, found: 0, toLoad: 4 });
  assert.deepEqual(countResult("reusable", 12, 10, 12), { used: 0, writtenOff: 2, found: 0, toLoad: 2 });
  assert.deepEqual(countResult("supply", 2, 5, 4), { used: 0, writtenOff: 0, found: 3, toLoad: 0 });
});

test("service due dates and book value", () => {
  assert.deepEqual(serviceDue({ lastServicedOn: null, purchasedOn: "2026-07-01" }, 90, "2026-10-18"), { dueOn: "2026-09-29", overdue: true, soon: false });
  assert.deepEqual(serviceDue({ lastServicedOn: "2026-10-10", purchasedOn: "2026-01-01" }, 14, "2026-10-18"), { dueOn: "2026-10-24", overdue: false, soon: true });
  assert.equal(serviceDue({ lastServicedOn: null, purchasedOn: "2026-01-01" }, null, "2026-10-18"), null);
  assert.equal(bookValue(60000, "2026-01-01", 24, "2027-01-01"), 30000);
  assert.equal(bookValue(60000, "2020-01-01", 24, "2026-10-18"), 0);
  assert.equal(bookValue(60000, "2026-01-01", null, "2027-01-01"), 60000);
});

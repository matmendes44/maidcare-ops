// Invoice amounts: what's typed must become exactly the cents billed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TOTAL_CENTS, MAX_UNIT_CENTS, parseCents, parseQuantity } from "../../app/(app)/finances/invoices/money";

test("prices parse to exact cents", () => {
  const cases: [string, number][] = [
    ["175", 17500],
    ["175.5", 17550],
    ["175.55", 17555],
    ["$1,234.56", 123456],
    [" 4.35 ", 435],
    ["0.29", 29],
    [".5", 50],
    ["5.", 500],
    ["19.99", 1999],
    ["-20", -2000],
    ["-0", 0],
  ];
  for (const [typed, cents] of cases) assert.equal(parseCents(typed), cents, typed);
});

test("prices that could be misread are rejected", () => {
  for (const typed of ["", ".", "-", "abc", "1e3", "175.555", "12.3.4", "--5", "1,2,3.4.5", "Infinity", "0x10", "١٢٣"]) {
    assert.equal(parseCents(typed), null, typed);
  }
});

test("no floating-point drift on any two-decimal price", () => {
  for (let cents = 0; cents <= 200_000; cents += 7) {
    const typed = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    assert.equal(parseCents(typed), cents, typed);
  }
});

test("quantities are whole numbers from 1 to 999", () => {
  assert.equal(parseQuantity("1"), 1);
  assert.equal(parseQuantity("999"), 999);
  for (const typed of ["0", "1000", "1.5", "1e2", "-1", "", "two", " 3x"]) assert.equal(parseQuantity(typed), null, typed);
});

test("limits stay inside what Stripe and the database accept", () => {
  assert.ok(MAX_UNIT_CENTS <= 99_999_999 && MAX_TOTAL_CENTS <= 99_999_999);
  assert.ok(MAX_TOTAL_CENTS < 2 ** 31);
});

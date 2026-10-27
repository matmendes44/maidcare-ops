// Contractor pay and 1099 rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { earnings, rateOn, type PayRate, type WorkedVisit } from "../../lib/contractors/pay";
import { dueDate, isNecReportable, maskTin, thresholdCents, tinProblem, yearStatus } from "../../lib/contractors/tax";

const day = (effectiveFrom: string, cents: number): PayRate => ({ effectiveFrom, payType: "day_rate", dayRateCents: cents, percentBp: null });
const visit = (id: number, d: string, price = 15000, crew = 1): WorkedVisit => ({ appointmentId: id, day: d, priceCents: price, contractorsOnVisit: crew });

test("a day rate pays once per day worked, however many visits", () => {
  const r = earnings([visit(1, "2026-10-05"), visit(2, "2026-10-05"), visit(3, "2026-10-06")], [day("2026-01-01", 12000)]);
  assert.equal(r.daysWorked, 2);
  assert.equal(r.totalCents, 24000);
  assert.deepEqual(r.days.map((d) => d.visits.length), [2, 1]);
});

test("a raise applies from its date; earlier days keep the old rate", () => {
  const rates = [day("2026-01-01", 12000), day("2026-10-06", 14000)];
  assert.equal(rateOn(rates, "2026-10-05")!.dayRateCents, 12000);
  assert.equal(rateOn(rates, "2026-10-06")!.dayRateCents, 14000);
  assert.equal(earnings([visit(1, "2026-10-05"), visit(2, "2026-10-06")], rates).totalCents, 26000);
});

test("days before any rate earn nothing and are listed", () => {
  const r = earnings([visit(1, "2026-03-01"), visit(2, "2026-10-01")], [day("2026-06-01", 10000)]);
  assert.equal(r.totalCents, 10000);
  assert.deepEqual(r.daysWithoutRate, ["2026-03-01"]);
});

test("a percent rate (for later) shares each visit's price between its contractors", () => {
  const pct: PayRate = { effectiveFrom: "2027-01-01", payType: "percent", dayRateCents: null, percentBp: 3500 };
  // 35% of $150 = $52.50, split between two = $26.25; plus 35% of $200 alone = $70
  assert.equal(earnings([visit(1, "2027-02-01", 15000, 2), visit(2, "2027-02-01", 20000, 1)], [pct]).totalCents, 2625 + 7000);
});

test("1099 thresholds, deadlines and which payments count", () => {
  assert.equal(thresholdCents(2025), 60000);
  assert.equal(thresholdCents(2026), 200000);
  assert.equal(thresholdCents(2030), 200000);
  assert.equal(dueDate(2026), "2027-02-01"); // Jan 31, 2027 is a Sunday
  assert.equal(dueDate(2025), "2026-02-02"); // Jan 31, 2026 is a Saturday
  assert.equal(dueDate(2027), "2028-01-31");
  for (const m of ["cash", "check", "bank_transfer", "zelle"]) assert.ok(isNecReportable(m), m);
  for (const m of ["credit_card", "debit_card", "app"]) assert.ok(!isNecReportable(m), m);
});

test("tax IDs are checked and only ever shown masked", () => {
  assert.equal(tinProblem("ssn", "123456789"), null);
  assert.ok(tinProblem("ssn", "000123456"));
  assert.ok(tinProblem("ssn", "900123456"));
  assert.ok(tinProblem("ssn", "123004567"));
  assert.ok(tinProblem("ssn", "12345678"));
  assert.equal(tinProblem("ein", "121234567"), null);
  assert.ok(tinProblem("ein", "001234567"));
  assert.equal(maskTin("ssn", "6789"), "•••-••-6789");
  assert.equal(maskTin("ein", "4567"), "••-•••4567");
});

test("who needs a 1099, and what's missing", () => {
  const base = { taxClassification: "individual", tinLast4: "6789", w9ReceivedOn: "2026-01-02", hasAddress: true, filed: null };
  assert.equal(yearStatus(2026, { ...base, reportableCents: 250000 }).state, "needs_1099");
  assert.equal(yearStatus(2026, { ...base, reportableCents: 150000 }).state, "below_threshold");
  assert.equal(yearStatus(2025, { ...base, reportableCents: 150000 }).state, "needs_1099");
  assert.equal(yearStatus(2026, { ...base, reportableCents: 900000, taxClassification: "s_corp" }).state, "exempt");
  const missing = yearStatus(2026, { ...base, reportableCents: 250000, tinLast4: null, w9ReceivedOn: null, hasAddress: false });
  assert.equal(missing.problems.length, 3);
  assert.match(missing.problems[1], /backup withholding/);
  const filed = yearStatus(2026, { ...base, reportableCents: 260000, filed: { reportedCents: 250000 } });
  assert.deepEqual([filed.state, filed.changedSinceFiled], ["filed", true]);
});

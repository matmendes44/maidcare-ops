// Roles: the owner can do everything; staff do what the owner decided
// (lib/auth/permissions.ts); admin keeps the everyday work.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canChangeAppointment } from "../../lib/appointments/access";
import { allowed, can, demoBlocked, permissions, roles, type Permission } from "../../lib/auth/permissions";
import { canEditExpense } from "../../lib/expenses/access";
import { expenseChanges } from "../../lib/expenses/changes";

const all = Object.keys(permissions) as Permission[];

// The rules are checked through allowed(), which takes the demo flag as an
// argument, so the result doesn't depend on DEMO_MODE in the environment.
test("the owner can do everything", () => {
  for (const p of all) assert.equal(allowed("owner", p, false), true, p);
});

test("the demo blocks users, Stripe and Bouncie for everyone, owner included", () => {
  for (const p of demoBlocked) for (const role of roles) assert.equal(allowed(role, p, true), false, `${role} ${p}`);
  // everything else the owner can still do
  for (const p of all.filter((p) => !demoBlocked.includes(p))) assert.equal(allowed("owner", p, true), true, p);
});

test("admin and staff can't move money, delete, or manage users yet", () => {
  for (const role of ["admin", "staff"] as const) {
    for (const p of ["invoices.collect", "invoices.finalize", "invoices.deleteDraft", "customers.delete", "users.manage"] as Permission[]) {
      assert.equal(allowed(role, p, false), false, `${role} ${p}`);
    }
  }
});

test("nobody signed out can do anything", () => {
  for (const p of all) assert.equal(can(null, p), false);
});

test("three roles", () => {
  assert.deepEqual([...roles], ["owner", "admin", "staff"]);
});

test("staff: estimates, one-time expenses and reports; nothing else", () => {
  const granted = all.filter((p) => allowed("staff", p, false)).sort();
  assert.deepEqual(granted, ["expenses.create", "expenses.view", "quotes.manage", "reports.view"]);
});

test("staff can change today's and future appointments only", () => {
  const staff = { role: "staff" as const };
  assert.equal(canChangeAppointment(staff, "2026-10-21T13:00:00Z", "2026-10-21"), true);
  assert.equal(canChangeAppointment(staff, "2026-10-30T13:00:00Z", "2026-10-21"), true);
  assert.equal(canChangeAppointment(staff, "2026-10-20T13:00:00Z", "2026-10-21"), false);
  // 11pm Eastern on the 20th is still the 20th
  assert.equal(canChangeAppointment(staff, "2026-10-21T03:00:00Z", "2026-10-21"), false);
  assert.equal(canChangeAppointment({ role: "owner" }, "2020-01-01T13:00:00Z", "2026-10-21"), true);
  assert.equal(canChangeAppointment(null, "2026-10-30T13:00:00Z", "2026-10-21"), false);
});

test("staff edit only the expenses they added; the owner any", () => {
  assert.equal(canEditExpense({ id: 7, role: "staff" }, 7), true);
  assert.equal(canEditExpense({ id: 7, role: "staff" }, 8), false);
  assert.equal(canEditExpense({ id: 7, role: "staff" }, null), false);
  assert.equal(canEditExpense({ id: 1, role: "owner" }, 8), true);
  assert.equal(canEditExpense(null, 7), false);
});

test("an expense edit is described field by field", () => {
  const before = { expenseDate: "2026-10-01", vendorName: "Sams Club", category: "supplies", amountCents: 4999, paymentMethod: "cash", cardBrand: null, cardLast4: null, reference: null, description: "Mops" };
  assert.deepEqual(expenseChanges(before, before), []);
  assert.deepEqual(expenseChanges(before, { ...before, amountCents: 5999, vendorName: "Costco", description: null }), [
    "Amount: $49.99 → $59.99",
    "Vendor: Sams Club → Costco",
    'Description: "Mops" → (none)',
  ]);
  assert.deepEqual(expenseChanges(before, { ...before, category: "fuel", paymentMethod: "credit_card", cardBrand: "visa", cardLast4: "1005" }), [
    "Category: Cleaning supplies → Fuel",
    "Paid by: Cash → Credit card",
    "Card: (none) → Visa",
    "Last 4: (none) → 1005",
  ]);
});

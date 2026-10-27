// Searches and flags that look into a second table. These once compared the
// inner table with itself (drizzle writes bare column names in single-table
// queries), so a contact's phone or a property's street never matched.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, like } from "drizzle-orm";
import { db } from "../../db";
import { contacts, contractors, customers, properties, vendors } from "../../db/schema";
import { searchEverything } from "../../lib/search";

let customerId = 0;
let vendorId = 0;

before(async () => {
  const [c] = await db.insert(customers).values({ customerCode: "STRIPETEST7", firstName: "Subquery", lastName: "Test" }).returning({ id: customers.id });
  customerId = c.id;
  await db.insert(contacts).values({ customerId, name: "Zelda Q", phone: "(410) 555-0199", isPrimary: true });
  await db.insert(properties).values({ customerId, street: "77 Quixotic Lane", city: "Baltimore", zip: "21201" });
  const [v] = await db.insert(vendors).values({ vendorCode: "V99901", name: "E2E Subquery Vendor" }).returning({ id: vendors.id });
  vendorId = v.id;
  await db.insert(contractors).values({ vendorId, firstName: "E2E Subquery", lastName: "Cleaner" });
});

after(async () => {
  await db.delete(contractors).where(eq(contractors.vendorId, vendorId));
  await db.delete(vendors).where(eq(vendors.id, vendorId));
  await db.delete(contacts).where(eq(contacts.customerId, customerId));
  await db.update(customers).set({ billingPropertyId: null }).where(eq(customers.id, customerId));
  await db.delete(properties).where(eq(properties.customerId, customerId));
  await db.delete(customers).where(like(customers.customerCode, "STRIPETEST7"));
});

test("header search finds a customer by a contact's phone and name", async () => {
  for (const q of ["555-0199", "4105550199", "Zelda"]) {
    const found = await searchEverything(q);
    assert.ok(found.some((r) => r.kind === "customer" && r.id === customerId), q);
  }
});

test("header search finds vendors by name when allowed, and not otherwise", async () => {
  assert.ok((await searchEverything("Subquery Vendor", { withVendors: true })).some((r) => r.kind === "vendor" && r.id === vendorId));
  assert.ok(!(await searchEverything("Subquery Vendor")).some((r) => r.kind === "vendor"));
});

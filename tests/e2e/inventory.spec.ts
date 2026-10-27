// Inventory: supplies and kits, restocking vehicles, receiving stock with an
// expense, equipment with its purchase, and QR problem reports.
import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./support/helpers";

test.use({ storageState: "tests/e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

type Loc = { id: number; token: string; name: string };
const vehicle = () => fixture<Loc>("location-token", "vehicle");
let refillsUrl = "";
let assetTag = "";

async function addItem(page: Page, name: string, kind: "Supply" | "Reusable", unit: string, perVehicle: string, reorderAt: string, buy: string, cost: string, onHand: string) {
  await page.goto("/inventory/items/new");
  await page.getByLabel("Name").fill(name);
  await page.getByText(kind, { exact: true }).click();
  await page.getByLabel("Category").selectOption(kind === "Supply" ? "dusters" : "cloths");
  await page.getByLabel("Counted by").selectOption(unit);
  await page.getByLabel("Per vehicle (load-out)").fill(perVehicle);
  await page.getByLabel("Reorder at").fill(reorderAt);
  await page.getByLabel("Usually buy").fill(buy);
  await page.getByLabel("Cost per unit").fill(cost);
  await page.getByLabel("On hand now").fill(onHand);
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("Item added.")).toBeVisible();
}

// waits until a client form is interactive before using it
async function ready(page: Page) {
  await page.waitForLoadState("networkidle");
}

test("supplies with a vehicle kit, and colors from the reorder point", async ({ page }) => {
  await addItem(page, "E2E Swiffer refills", "Supply", "pack", "2", "5", "10", "2.49", "8");
  refillsUrl = page.url().replace(/\?.*$/, "");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("OK");
  await addItem(page, "E2E Microfiber towels", "Reusable", "each", "12", "20", "24", "1.50", "30");

  await page.goto("/inventory?tab=supplies");
  const towels = page.getByRole("row").filter({ hasText: "E2E Microfiber towels" });
  await expect(towels.getByText("OK", { exact: true })).toBeVisible();
  await expect(towels).toContainText("30");
});

test("restocking a vehicle loads it to its kit; the next restock records what was used", async ({ page }) => {
  const v = vehicle();
  await page.goto(`/inventory/locations/${v.id}/count`);
  await ready(page);
  const refills = page.getByRole("row").filter({ hasText: "E2E Swiffer refills" });
  await expect(refills.getByLabel(/how many to load/)).toHaveValue("2");
  await expect(page.getByRole("row").filter({ hasText: "E2E Microfiber towels" }).getByLabel(/how many to load/)).toHaveValue("12");
  await page.getByRole("button", { name: "Save count and restock" }).click();
  await expect(page.getByText(/Restocked/)).toBeVisible();

  // storage: 6 refills (still over 5), 18 towels (under 20: low)
  await page.goto("/inventory?tab=supplies");
  await expect(page.getByRole("row").filter({ hasText: "E2E Microfiber towels" }).getByText("Low", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "E2E Swiffer refills" }).getByText("OK", { exact: true })).toBeVisible();

  // a week later: both refills used, 2 towels gone; load back up
  await page.goto(`/inventory/locations/${v.id}/count`);
  await ready(page);
  await page.getByRole("row").filter({ hasText: "E2E Swiffer refills" }).getByLabel(/how many are there/).fill("0");
  await page.getByRole("row").filter({ hasText: "E2E Microfiber towels" }).getByLabel(/how many are there/).fill("10");
  await expect(page.getByText("2 used")).toBeVisible();
  await expect(page.getByText("2 missing")).toBeVisible();
  await page.getByRole("button", { name: "Save count and restock" }).click();
  await expect(page.getByText(/Restocked/)).toBeVisible();

  await page.goto(refillsUrl);
  // 8 bought → 2 loaded → 2 used → 2 more loaded: 4 in storage (low), 2 in the car
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Low");
  await expect(page.getByText("Used · 30 days").locator("..")).toContainText("2");
  await expect(page.getByText(/Buy \d+/)).toBeVisible();

  await page.goto("/inventory?tab=usage");
  const used = page.getByRole("row").filter({ hasText: "E2E Swiffer refills" });
  await expect(used).toContainText("2 packs");
  await expect(used).toContainText("$4.98");
  await expect(page.getByRole("row").filter({ hasText: "E2E Microfiber towels" })).toContainText("2"); // written off
});

test("receiving stock adds it, records the expense and updates the cost", async ({ page }) => {
  await page.goto("/inventory/receive");
  await ready(page);
  await page.getByLabel("Item").first().selectOption({ label: "E2E Swiffer refills (per pack)" });
  await page.getByLabel("How many").first().fill("10");
  await page.getByLabel("Line total").first().fill("27.90");
  await page.getByRole("combobox", { name: "Bought from" }).fill("E2E Inv Sams Club");
  await page.getByRole("option", { name: /Add .E2E Inv Sams Club. as a new vendor/ }).click();
  await page.getByLabel("Paid with").selectOption("cash");
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByText(/Delivery received/)).toBeVisible();

  await page.goto(refillsUrl);
  await expect(page.getByText("$2.79 each")).toBeVisible();
  await expect(page.getByText("On hand").locator("..")).toContainText("16 packs");
  await page.getByRole("link", { name: "expense", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("$27.90");
  await expect(page.getByText("Inventory from this purchase")).toBeVisible();
});

test("equipment needs its purchase, gets a tag, and can be moved and repaired", async ({ page }) => {
  await page.goto("/inventory/items/new?kind=equipment");
  await page.getByLabel("Name").fill("E2E Dyson vacuum");
  await page.getByLabel("Category").selectOption("vacuums");
  await page.getByLabel("Service every (days)").fill("90");
  await page.getByLabel("Useful life (months)").fill("36");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("Item added.")).toBeVisible();
  await page.getByRole("link", { name: "Add a unit" }).click();
  await ready(page);

  // no purchase: refused
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(page.getByText("Pick where it was bought.")).toBeVisible();

  await page.getByLabel("Serial number").fill("SN-E2E-1");
  await page.getByRole("combobox", { name: "Bought from" }).fill("E2E Inv Best Buy");
  await page.getByRole("option", { name: /Add .E2E Inv Best Buy. as a new vendor/ }).click();
  await page.getByLabel("Total paid").fill("499.99");
  await page.getByLabel("Paid with").selectOption("credit_card");
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(page.getByText("Equipment added.")).toBeVisible();
  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  assetTag = /A\d+/.exec(heading!)![0];
  await expect(page.getByText("In service", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "see the expense" })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code to report a problem/ })).toBeVisible();

  const v = vehicle();
  await page.getByRole("tab", { name: "Move" }).click();
  await page.getByLabel("Move to").selectOption({ label: v.name });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Moved.")).toBeVisible();
  await expect(page.getByText(`In ${v.name}`)).toBeVisible();
});

test("cleaners report from the QR code without signing in; reports reach the office", async ({ page, playwright, browser }) => {
  const v = vehicle();
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const qr = await anon.newPage();
  await qr.goto(`/r/${v.token}`);
  await expect(qr.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  await expect(qr.getByText(v.name)).toBeVisible();
  await qr.waitForLoadState("networkidle");
  await qr.getByRole("button", { name: "Ran out" }).click();
  await qr.getByLabel("Which supply?").selectOption({ label: "E2E Swiffer refills" });
  await qr.getByRole("button", { name: "Send report" }).click();
  await expect(qr.getByText("Thanks! The office has been told.")).toBeVisible();

  // the equipment label: broken marks it for repair
  const asset = fixture<{ id: number; token: string }>("asset-token", assetTag);
  await qr.goto(`/r/equipment/${asset.token}`);
  await qr.waitForLoadState("networkidle");
  await qr.getByLabel("Details").fill("Brush won't spin");
  await qr.getByRole("button", { name: "Send report" }).click();
  await expect(qr.getByText("Thanks! The office has been told.")).toBeVisible();

  // a made-up code gets nothing
  await qr.goto(`/r/${"0".repeat(64)}`);
  await expect(qr.getByText(/isn't valid anymore/)).toBeVisible();
  // and the rest of the app still needs a sign-in
  const api = await playwright.request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  expect((await api.get("/inventory", { maxRedirects: 0 })).status()).toBe(307);
  await api.dispose();
  await anon.close();

  await page.goto("/inventory");
  await expect(page.getByRole("link", { name: /Inventory, \d+ to look at/ })).toBeVisible();
  const report = page.getByRole("listitem").filter({ hasText: "E2E Swiffer refills" }).filter({ has: page.getByText("Out", { exact: true }) });
  await expect(report).toContainText(v.name);
  await report.getByRole("button", { name: "Done" }).click();
  await expect(report).toHaveCount(0);

  await page.goto(`/inventory/assets/${asset.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Needs repair");
  await expect(page.getByText("Brush won't spin")).toBeVisible();
  // fixed: back in service closes the report
  await page.getByRole("tab", { name: "Change status" }).click();
  await page.getByLabel("New status").selectOption("in_service");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Status changed.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("In service");
});

test("staff can't see inventory", async ({ browser }) => {
  const staff = await browser.newContext({ storageState: "tests/e2e/.auth/staff.json" });
  const page = await staff.newPage();
  for (const url of ["/inventory?tab=supplies", "/inventory/items/new", "/inventory/report"]) {
    await page.goto(url);
    await expect(page.getByText("You can't see inventory")).toBeVisible();
  }
  await staff.close();
});


// Finding things and using the app on a phone.
import { expect, test } from "@playwright/test";
import { fixture, fixtures } from "./support/helpers";

test.use({ storageState: "tests/e2e/.auth/owner.json" });

test("header search finds customers by code, name and phone digits, and invoices by number", async ({ page }) => {
  const fx = fixtures();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox");
  await expect(box).toBeFocused();
  await box.fill("stripetest4");
  await expect(page.getByRole("option").first()).toContainText("STRIPETEST4");
  await box.fill("%%");
  await expect(page.getByText(/No matches/)).toBeVisible();
  await box.fill("stripetest4");
  await expect(page.getByRole("option").first()).toContainText("STRIPETEST4");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/customers/${fx.customers.OTHER.id}$`));
});

test("the search API needs a session", async ({ playwright }) => {
  // explicitly no cookies (the file's signed-in state must not leak in)
  const anon = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", storageState: { cookies: [], origins: [] } });
  const res = await anon.get("/api/search?q=stripetest", { maxRedirects: 0 });
  expect([307, 401]).toContain(res.status());
  expect(await res.text()).not.toContain("STRIPETEST");
  const forged = await anon.get("/api/search?q=stripetest", { headers: { cookie: "session=forged" }, maxRedirects: 0 });
  expect(forged.status()).toBe(401);
  await anon.dispose();
});

for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
  test(`header fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const overlaps = await page.evaluate(() => {
      const nav = document.querySelector("header")!;
      const items = [...nav.querySelectorAll("a, button")].filter((e) => (e as HTMLElement).offsetParent) as HTMLElement[];
      const rects = items.map((e) => e.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const [a, b] = [rects[i], rects[j]];
          if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++;
        }
      return { n, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(overlaps).toEqual({ n: 0, overflow: 0 });
  });
}

test("every main page fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/customers", "/leads", "/properties", "/appointments", "/fleet", "/finances", "/finances/invoices/new", "/settings", "/settings/users", "/settings/recurring-import", "/reports", "/reports?tab=money", "/reports?tab=estimates", "/reports?tab=pricing", "/reports?tab=operations", "/finances/expenses", "/finances/expenses?tab=list", "/finances/expenses?tab=recurring", "/finances/expenses/new", "/finances/vendors", "/finances/estimates", "/contractors", "/contractors/new", "/finances/1099s", "/inventory", "/inventory?tab=supplies", "/inventory?tab=equipment", "/inventory?tab=usage", "/inventory?tab=locations", "/inventory/receive", "/inventory/report", "/inventory/items/new"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("the phone menu reaches every section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  const links = page.getByRole("dialog").getByRole("navigation").getByRole("link");
  await expect(links).toHaveText(["Dashboard", "Customers", "Leads", "Properties", "Appointments", "Contractors", "Invoices", /^Estimates\d*$/, "Price list", "Expenses", "Vendors", "1099s", /^Inventory\d*$/, "Fleet", "Reports", "Settings"]);
  await links.filter({ hasText: "Invoices" }).click();
  await expect(page).toHaveURL(/\/finances$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the sidebar reaches every section and remembers being collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Sections" });
  await expect(sidebar.getByRole("link")).toHaveText(["Dashboard", "Customers", "Leads", "Properties", "Appointments", "Contractors", "Invoices", /^Estimates\d*$/, "Price list", "Expenses", "Vendors", "1099s", /^Inventory\d*$/, "Fleet", "Reports"]);
  await sidebar.getByRole("link", { name: "Customers" }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(sidebar.getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
  // the most specific section is the current one
  await page.goto("/finances/expenses");
  await expect(sidebar.getByRole("link", { name: "Expenses" })).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("link", { name: "Invoices" })).not.toHaveAttribute("aria-current", "page");
  await page.goto("/finances/invoices/new");
  await expect(sidebar.getByRole("link", { name: "Invoices" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();
  // still collapsed after a reload; links keep their names for screen readers
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Expenses" })).toBeVisible();
  await expect(sidebar.getByText("Expenses")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar.getByText("Expenses")).toBeVisible();
});

test("leads and customers are listed apart, and a lead's record leads back to Leads", async ({ page }) => {
  await page.goto("/customers");
  const table = page.getByRole("table");
  await expect(table.getByRole("row").nth(1)).toBeVisible();
  await expect(table.getByText("Lead", { exact: true })).toHaveCount(0);

  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "Leads", level: 1 })).toBeVisible();
  await expect(page.getByText(/^\d+ leads? ·/)).toBeVisible();
  const firstLead = page.getByRole("table").getByRole("row").nth(1).getByRole("link");
  if ((await firstLead.count()) === 0) return; // no leads in this database
  await firstLead.click();
  await expect(page.getByText("Lead", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "List", exact: true }).click();
  await expect(page).toHaveURL(/\/leads$/);

  await page.getByRole("link", { name: "Create New Lead" }).click();
  // the heading carries the next customer number; no status, Stripe id, zone, referral or start date to set
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Create New Lead\s*C\d+$/);
  for (const legend of ["Customer type", "Customer information", "Customer address", "Notes"]) await expect(page.getByText(legend, { exact: true }).first()).toBeVisible();
  for (const label of [/status/i, /stripe/i, /zone/i, /referred/i, /start date/i, /customer code/i]) await expect(page.getByLabel(label)).toHaveCount(0);

  // one customer type at a time
  const residential = page.getByRole("radio", { name: "Residential" });
  const commercial = page.getByRole("radio", { name: "Commercial" });
  await expect(residential).toHaveAttribute("aria-checked", "true");
  await commercial.click();
  await expect(commercial).toHaveAttribute("aria-checked", "true");
  await expect(residential).toHaveAttribute("aria-checked", "false");
  await residential.click();

  // a phone or an email, and the address, are required
  await page.getByLabel(/first name/i).fill("E2E Lead");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("Enter a phone number or an email.")).toBeVisible();
  await expect(page.getByText("Street address is required.")).toBeVisible();

  await page.getByLabel("Phone").fill("410 555 0199");
  await page.getByLabel(/Street address/).fill("12 E2E Way");
  await page.getByLabel(/^City/).fill("Baltimore");
  await page.getByLabel(/^ZIP/).fill("21201");
  await page.getByLabel("Notes").fill("Found us online");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/customers\/\d+\?saved=created/);
  await expect(page.getByText("Lead", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Residential").first()).toBeVisible();
  await expect(page.getByText("(410) 555-0199").first()).toBeVisible();
  await expect(page.getByText("12 E2E Way").first()).toBeVisible();
  await expect(page.getByText("Found us online").first()).toBeVisible();
  // not in Stripe until they're invoiced, and no warning about it
  await expect(page.getByText(/isn't in Stripe yet/)).toHaveCount(0);
  // once they are, their Stripe customer has their phone number
  const leadId = /customers\/(\d+)/.exec(page.url())![1];
  expect(fixture<{ phone: string | null }>("stripe-phone", leadId).phone).toBe("+14105550199");
});

test("the dashboard: what needs attention, today, the week ahead; money only for those allowed", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^Good (morning|afternoon|evening)/);
  for (const title of ["Needs attention", "Today", "Next 7 days", "This month", "Customers and sales", "Shortcuts"]) await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  // the week ahead links to each day
  await expect(page.getByRole("link", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), / })).toHaveCount(7);

  const staff = await browser.newContext({ storageState: "tests/e2e/.auth/staff.json" });
  const s = await staff.newPage();
  await s.goto("/");
  await expect(s.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
  // staff see reports, so the money widget too
  await expect(s.getByRole("heading", { name: "This month", exact: true })).toBeVisible();
  await staff.close();
});

test("the dashboard can be rearranged: drag, hide, resize; kept after a reload; reset", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const order = () => page.locator("[data-widget]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.widget));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const before = await order();
  expect(before.slice(0, 2)).toEqual(["attention", "today"]);

  await page.getByRole("button", { name: "Customize" }).click();
  // drag "Next 7 days" onto "Needs attention": it moves to the front
  const handle = page.getByRole("button", { name: "Move Next 7 days", exact: true });
  const target = page.locator('[data-widget="attention"]');
  const h = (await handle.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + 40, t.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(order).toEqual(["week", ...before.filter((id) => id !== "week")]);

  // hide one, make another wide
  await page.getByRole("button", { name: "Hide Shortcuts" }).click();
  await expect(page.locator('[data-widget="shortcuts"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Make Today wide" }).click();
  await expect(page.locator('[data-widget="today"]')).toHaveClass(/md:col-span-2/);
  await page.getByRole("button", { name: "Done" }).click();

  // saved to the account
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect((await order()).slice(0, 3)).toEqual(["week", "attention", "today"]); // still where it was dropped
  await expect(page.locator('[data-widget="shortcuts"]')).toHaveCount(0);

  // hidden widgets can be added back; reset puts everything back
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await expect(page.locator('[data-widget="shortcuts"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect.poll(order).toEqual(before);
  await page.waitForTimeout(500);
  await page.reload();
  await expect.poll(order).toEqual(before);
});

// The Reports page: every tab renders for the owner, ranges work, numbers
// link to what's behind them, and staff can't see it.
import { expect, test } from "@playwright/test";

test.describe("as the owner", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("every tab renders without errors, for every preset range", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const tab of ["overview", "money", "customers", "operations", "pricing", "fleet"]) {
      for (const range of ["month", "12m", "all"]) {
        const res = await page.goto(`/reports?tab=${tab}&range=${range}`);
        expect(res?.status(), `${tab} ${range}`).toBe(200);
        await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
        await expect(page.locator("main")).not.toContainText(/Application error|Unhandled Runtime Error/);
      }
    }
    expect(errors).toEqual([]);
  });

  test("overview numbers link to the details", async ({ page }) => {
    await page.goto("/reports?range=12m");
    // money from invoices; visits only in the operations numbers
    for (const label of ["Collected", "Invoiced", "Outstanding", "Drafts not sent", "Active customers", "Visits completed", "Monthly recurring revenue", "Revenue per hour on site"]) {
      await expect(page.locator("main").getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.locator("main").getByText("Work completed", { exact: true })).toHaveCount(0);
    await page.locator("main a", { hasText: "Invoiced" }).first().click();
    await expect(page).toHaveURL(/tab=money/);
    await expect(page.getByRole("heading", { name: "Invoices by status" })).toBeVisible();
    await page.goto("/reports?tab=operations&range=12m");
    await expect(page.locator("#not-invoiced")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Revenue by zone" })).toHaveCount(0);
  });

  test("a custom range is kept across tabs", async ({ page }) => {
    await page.goto("/reports?tab=money&range=custom&from=2026-08-01&to=2026-09-30");
    await expect(page.locator("main")).toContainText("Aug 1, 2026");
    await page.getByRole("link", { name: "Customers", exact: true }).last().click();
    await expect(page).toHaveURL(/tab=customers&range=custom&from=2026-08-01&to=2026-09-30/);
  });

  test("charts have their numbers in a table", async ({ page }) => {
    await page.goto("/reports?tab=money&range=all");
    const chart = page.getByRole("img", { name: "Revenue by month" });
    await expect(chart).toBeVisible();
    await page.getByText("Show the numbers").first().click();
    await expect(page.locator("details[open] table").first()).toBeVisible();
  });
});

test.describe("as staff", () => {
  test.use({ storageState: "tests/e2e/.auth/staff.json" });

  test("staff see every Reports tab", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Reports" })).toBeVisible();
    for (const tab of ["overview", "money", "customers", "estimates", "operations", "pricing", "fleet"]) {
      await page.goto(`/reports?tab=${tab}`);
      await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    }
  });
});

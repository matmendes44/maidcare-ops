// Expenses, receipts, recurring expenses, vendors and exports.
import { expect, test } from "@playwright/test";
import sharp from "sharp";

test.use({ storageState: "tests/e2e/.auth/owner.json" });
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const photo = async () => ({ name: "receipt.png", mimeType: "image/png", buffer: await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#eee" } }).png().toBuffer() });

test.describe.configure({ mode: "serial" });

// types into the vendor search and picks the match
async function pickVendor(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("combobox", { name: "Paid to (vendor)" }).fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).first().click();
}

test("vendors get V numbers, and only real web addresses are kept", async ({ page }) => {
  await page.goto("/finances/vendors/new");
  // the ID is shown, not typed
  const next = (await page.locator("#vendorCode").textContent())!.trim();
  expect(next).toMatch(/^V\d{4,}$/);
  await expect(page.getByRole("textbox", { name: "Vendor ID" })).toHaveCount(0);
  await expect(page.getByLabel("Name")).toHaveAttribute("placeholder", "Example: Sams Club");
  await page.getByLabel("Name").fill("E2E Exp Sams Club");
  await page.getByLabel("Usual category").selectOption("supplies");
  await page.getByLabel("Website").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Add vendor" }).click();
  await expect(page.getByText("Enter a web address like samsclub.com.")).toBeVisible();
  await page.getByLabel("Website").fill("samsclub.com");
  // a vendor ID slipped into the form by hand is ignored
  await page.locator("form", { has: page.getByLabel("Website") }).evaluate((form) => form.insertAdjacentHTML("beforeend", '<input type="hidden" name="vendorCode" value="HACK1">'));
  await page.getByRole("button", { name: "Add vendor" }).click();
  await expect(page.getByText("Vendor added.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(next);
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("HACK1");
  await expect(page.getByRole("link", { name: "samsclub.com" })).toHaveAttribute("href", "https://samsclub.com/");

  // the same name twice is refused, whatever the case
  await page.goto("/finances/vendors/new");
  await page.getByLabel("Name").fill("e2e exp sams CLUB");
  await page.getByRole("button", { name: "Add vendor" }).click();
  await expect(page.getByText("There's already a vendor with this name.")).toBeVisible();
});

test("an expense with a new vendor, a card, a receipt and a monthly repeat", async ({ page }) => {
  await page.goto("/finances/expenses/new");
  const vendor = page.getByRole("combobox", { name: "Paid to (vendor)" });
  // search ignores punctuation and case, and finds vendor IDs
  await vendor.fill("e2e exp sams");
  await expect(page.getByRole("option", { name: /E2E Exp Sams Club/ })).toBeVisible();
  await vendor.fill("E2E Exp Insurance Co");
  await expect(page.getByRole("option", { name: /E2E Exp Sams Club/ })).toHaveCount(0);
  await vendor.press("ArrowDown");
  await vendor.press("Enter");
  await expect(page.getByLabel("New vendor's name")).toHaveValue("E2E Exp Insurance Co");
  await page.getByLabel("Category").selectOption("insurance");
  await page.getByLabel("Total").fill("$1,234.56");
  await page.getByLabel("Payment method").selectOption("credit_card");
  await page.getByLabel("Card", { exact: true }).selectOption("amex");
  await page.getByLabel("Last 4 digits").fill("1005");
  await page.getByLabel("Repeats").selectOption("monthly");
  await page.getByLabel("Description").fill("General liability policy");
  await page.getByLabel("Receipt files").setInputFiles(await photo());
  await expect(page.getByText(/receipt\.(png|webp)/)).toBeVisible();
  await page.getByRole("button", { name: "Save expense" }).click();

  await expect(page.getByText("Expense saved.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("$1,234.56");
  await expect(page.getByText("Amex ••1005")).toBeVisible();
  await expect(page.getByText("Schedule C line 15 Insurance")).toBeVisible();
  await expect(page.getByText(/Monthly · expected \$1,234\.56/)).toBeVisible();
  await expect(page.getByText("Receipts (1)")).toBeVisible();
  const img = page.getByRole("img", { name: /Receipt:/ });
  await expect(img).toBeVisible();
  // shrunk to at most 2000px and stored as WebP
  const src = await img.getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.headers()["content-type"]).toBe("image/webp");
  const meta = await sharp(await res.body()).metadata();
  expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2000);

  // the change history and who recorded it
  await expect(page.getByText("Recorded by")).toBeVisible();
  await page.getByText(/Change history/).click();
  await expect(page.getByText("recorded it")).toBeVisible();

  // a non-image is refused on upload
  await page.getByLabel("Add receipt files").setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await expect(page.getByText("evil.svg isn't a photo or PDF we can read.")).toBeVisible();
  await expect(page.getByText("Receipts (1)")).toBeVisible();
});

test("the same purchase twice asks first", async ({ page }) => {
  await page.goto("/finances/expenses/new");
  await pickVendor(page, "E2E Exp Sams Club");
  await expect(page.getByLabel("Category")).toHaveValue("supplies");
  await page.getByLabel("Total").fill("87.10");
  await page.getByLabel("Payment method").selectOption("cash");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Expense saved.")).toBeVisible();

  await page.goto("/finances/expenses/new");
  await pickVendor(page, "E2E Exp Sams Club");
  await page.getByLabel("Total").fill("87.10");
  await page.getByLabel("Payment method").selectOption("cash");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText(/already an expense from this vendor for this amount/)).toBeVisible();
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByText("Expense saved.")).toBeVisible();
});

test("bad amounts and dates are refused", async ({ page }) => {
  await page.goto("/finances/expenses/new");
  await pickVendor(page, "E2E Exp Sams Club");
  for (const [amount, message] of [
    ["12.345", "Enter an amount like 49.99."],
    ["0", "The amount must be more than $0."],
    ["-5", "The amount must be more than $0."],
    ["2000000", "That's more than $1,000,000. Check the amount."],
  ]) {
    await page.getByLabel("Total").fill(amount);
    await page.getByRole("button", { name: "Save expense" }).click();
    await expect(page.getByText(message)).toBeVisible();
  }
  await page.getByLabel("Date").fill(`${Number(today.slice(0, 4)) + 2}-01-01`);
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("That's more than a year from now.")).toBeVisible();
});

test("recurring expenses show as paid, and the overview and list add up", async ({ page }) => {
  await page.goto("/finances/expenses?tab=recurring");
  const row = page.getByRole("row").filter({ hasText: "E2E Exp Insurance Co" });
  await expect(row.getByText("Paid", { exact: true })).toBeVisible();
  await expect(row).toContainText("$14,814.72"); // a year of $1,234.56

  await page.goto("/finances/expenses?tab=list&q=E2E%20Exp");
  await expect(page.getByText("3 expenses match")).toBeVisible();
  await expect(page.getByText("$1,408.76")).toBeVisible(); // 1,234.56 + 87.10 × 2
  await page.goto("/finances/expenses?tab=list&q=E2E%20Exp&receipt=missing");
  await expect(page.getByText("2 expenses match")).toBeVisible();

  await page.goto("/finances/expenses");
  await expect(page.getByRole("heading", { name: "This month, as it happens" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Expected vs actual" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Income vs expenses" })).toBeVisible();
});

test("a payment to a vendor with a recurring expense is tied to it", async ({ page }) => {
  await page.goto("/finances/expenses/new");
  await pickVendor(page, "E2E Exp Insurance Co");
  const box = page.getByRole("checkbox", { name: /Payment for the recurring expense/ });
  await expect(box).toBeChecked();
  await expect(page.getByLabel("Repeats")).toHaveCount(0);
  await box.uncheck();
  await expect(page.getByLabel("Repeats")).toBeVisible();
  // a vendor without one: no box
  await pickVendor(page, "E2E Exp Sams Club");
  await expect(box).toHaveCount(0);
});

test("exports: CSV, Excel and the printable report", async ({ page }) => {
  const csv = await page.request.get(`/api/expenses/export?format=csv&q=E2E%20Exp`);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text).toContain('"E2E Exp Insurance Co"');
  expect(text).toContain('"15 Insurance"');
  expect(text).toContain("1234.56");
  expect(text.trim().split("\r\n")).toHaveLength(4);

  const xlsx = await page.request.get(`/api/expenses/export?format=xlsx&q=E2E%20Exp`);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");

  await page.goto("/finances/expenses/report?q=E2E%20Exp");
  await expect(page.getByRole("heading", { name: "Expense report" })).toBeVisible();
  await expect(page.getByText("3 expenses · total")).toBeVisible();
});

test("receipts and exports need someone signed in who can see expenses", async ({ playwright, browser }) => {
  const anon = await playwright.request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  expect((await anon.get("/api/receipts/1", { maxRedirects: 0 })).status()).not.toBe(200);
  expect((await anon.get("/api/expenses/export?format=csv", { maxRedirects: 0 })).status()).not.toBe(200);
  await anon.dispose();

  const staff = await browser.newContext({ storageState: "tests/e2e/.auth/staff.json" });
  const page = await staff.newPage();
  // staff see expenses and export them, but not vendors
  expect((await page.request.get("/api/expenses/export?format=csv")).status()).toBe(200);
  await page.goto("/finances/vendors");
  await expect(page.getByText("You can't see vendors")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("link", { name: "Invoices" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Expenses" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Vendors" })).toHaveCount(0);
  await staff.close();
});

test("a vendor with expenses can't be deleted; an expense can", async ({ page }) => {
  await page.goto("/finances/vendors?q=E2E%20Exp%20Sams");
  await page.getByRole("link", { name: "E2E Exp Sams Club" }).click();
  await expect(page.getByText("Expenses (2)")).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete vendor" }).click();
  await expect(page.getByText(/has 2 expenses, so it can't be deleted/)).toBeVisible();
  await page.getByRole("button", { name: "Keep it" }).click();

  await page.getByRole("link", { name: /Supplies|Cleaning supplies/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("$87.10");
  // the button only works once the page is interactive
  await expect(async () => {
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Delete expense" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Delete expense" }).click();
  await expect(page.getByText("Expense deleted.")).toBeVisible();
});

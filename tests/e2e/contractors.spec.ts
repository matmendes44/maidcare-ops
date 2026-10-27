// Contractors: pay by the day from their appointments, payments, tax IDs,
// documents and 1099s.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fixture, fixtures, totp } from "./support/helpers";

test.use({ storageState: "tests/e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
let mariaUrl = "";

// A code from the owner's authenticator. Each code works once, and other
// tests sign in as the owner, so wait for a brand-new 30-second step.
async function code() {
  const now = Math.floor(Date.now() / 30_000);
  while (Math.floor(Date.now() / 30_000) <= now) await new Promise((r) => setTimeout(r, 500));
  return totp(fixtures().owner.secret!);
}

// Enters a code and submits; another test may have used it already (a code
// a step ahead is accepted at sign-in), so a refusal gets the next code.
async function submitWithCode(page: Page, submit: () => Promise<unknown>, done: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel("Code from your authenticator app").fill(await code());
    await submit();
    await expect(page.getByRole("button", { name: /Checking…|Preparing…/ })).toHaveCount(0);
    if (await done()) return;
  }
  throw new Error("No code was accepted");
}

async function addContractor(page: Page, first: string, last: string, rate: string, tin?: string) {
  await page.goto("/contractors/new");
  await page.getByLabel("Legal first name").fill(first);
  await page.getByLabel("Legal last name").fill(last);
  await page.getByLabel("Day rate").fill(rate);
  await page.getByLabel("Street").fill("1 Test Way");
  await page.getByLabel("City").fill("Baltimore");
  await page.getByLabel("State").fill("md");
  await page.getByLabel("ZIP").fill("21201");
  if (tin) {
    await page.getByLabel("W-9 received").fill(today);
    await page.getByLabel("Tax ID number").fill(tin);
  }
  await page.getByRole("button", { name: "Add contractor" }).click();
  await expect(page.getByText("Contractor added.")).toBeVisible();
}

// Books on the new-appointment form: an open invoice (made for it), who,
// when and the first vehicle; then the summary has to be confirmed. With no crew it stops at the
// red outlines.
// the invoice card with this id (cards are labelled by number and amount)
async function pickInvoice(page: Page, id: number) {
  const number = fixture<{ number: string | null }>("invoice-number", String(id)).number!;
  await page.getByRole("radiogroup", { name: "Invoice" }).getByRole("radio", { name: new RegExp(`^${number} `) }).click();
}

async function book(page: Page, crew: string[], start = "09:00", end = "11:00") {
  const fx = fixtures();
  const inv = fixture<{ id: number }>("open-invoice", String(fx.customers.PLAIN.id), "15000");
  await page.goto(`/appointments/new?customer=${fx.customers.PLAIN.id}&date=${today}`);
  await page.waitForLoadState("networkidle");
  await pickInvoice(page, inv.id);
  await page.getByLabel("Start").fill(start);
  await page.getByLabel("End").fill(end);
  await page.getByRole("group", { name: "Vehicles" }).getByRole("button").first().click();
  if (crew.length) {
    await page.locator("#contractorIds").click();
    for (const name of crew) await page.getByRole("option", { name }).click();
    await page.getByRole("button", { name: "Done" }).click();
  }
  await page.getByRole("button", { name: "Book appointment" }).click();
  if (crew.length) await page.getByRole("button", { name: "Confirm and book" }).click();
}

test("a contractor's tax ID is checked, stored encrypted and only shown after a fresh code", async ({ page }) => {
  await page.goto("/contractors/new");
  await page.getByLabel("Legal first name").fill("E2E Bad");
  await page.getByLabel("Legal last name").fill("Number");
  await page.getByLabel("Tax ID number").fill("000-12-3456");
  await page.getByRole("button", { name: "Add contractor" }).click();
  await expect(page.getByText("That isn't a valid Social Security number.")).toBeVisible();

  await addContractor(page, "E2E Maria", "Silva", "150", "123-45-6789");
  mariaUrl = page.url().replace(/\?.*$/, "");
  await expect(page.getByText("•••-••-6789")).toBeVisible();
  // the number itself isn't anywhere in the page
  const html = await page.content();
  expect(html).not.toContain("123-45-6789");
  expect(html).not.toContain("123456789");

  await page.getByRole("button", { name: "Show" }).click();
  await page.getByLabel("Code from your authenticator app").fill("000000");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByText(/That code isn't right/)).toBeVisible();
  await submitWithCode(
    page,
    () => page.getByRole("button", { name: "Show" }).click(),
    () => page.getByText("123-45-6789").isVisible(),
  );
  await expect(page.getByText("123-45-6789")).toBeVisible();
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByText("123-45-6789")).toHaveCount(0);

  // they got a vendor record for their payments
  await expect(page.getByRole("link", { name: /^Vendor V\d+/ })).toBeVisible();
  await addContractor(page, "E2E Ana", "Lima", "120");
});

test("appointments need a contractor, and nobody can be in two places at once", async ({ page }) => {
  await book(page, []);
  await expect(page.getByText("Fill in the fields outlined in red.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and book" })).toHaveCount(0);
  await page.locator("#contractorIds").click();
  await page.getByRole("option", { name: "E2E Maria Silva" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Book appointment" }).click();
  await page.getByRole("button", { name: "Confirm and book" }).click();
  await expect(page).toHaveURL(/\/appointments\/\d+\?saved=created/);
  await expect(page.getByRole("link", { name: "E2E Maria Silva" })).toBeVisible();
  const first = page.url();

  await book(page, ["E2E Maria Silva"], "10:00", "12:00");
  await expect(page.getByText(/E2E Maria is already booked/)).toBeVisible();

  // completing the first one is a day worked
  await page.goto(first);
  await page.getByRole("button", { name: "Mark completed" }).click();
  await expect(page).toHaveURL(/saved=completed/);
});

test("days worked earn the day rate in force that day", async ({ page }) => {
  await page.goto(mariaUrl);
  await expect(page.getByText("Days worked · this week").locator("..")).toContainText("1");
  await expect(page.getByText("Earned · this week").locator("..")).toContainText("$150.00");
  await expect(page.getByText("Unpaid").first().locator("..")).toContainText("$150.00");

  // a raise from tomorrow doesn't change today
  await page.getByLabel("New day rate").fill("175");
  await page.getByLabel("Starting").fill(tomorrow);
  await page.getByRole("button", { name: "Save rate" }).click();
  await expect(page.getByText("Day rate saved.")).toBeVisible();
  await expect(page.getByText("Upcoming")).toBeVisible();
  await expect(page.getByText("Earned · this week").locator("..")).toContainText("$150.00");
});

test("paying them is an expense, and counts toward the 1099 unless it's by card", async ({ page }) => {
  await page.goto(mariaUrl);
  await page.getByRole("link", { name: "Record a payment" }).click();
  await expect(page.getByLabel("Total")).toHaveValue("150.00");
  await expect(page.getByLabel("Category")).toHaveValue("contractors");
  await page.getByLabel("Payment method").selectOption("credit_card");
  await expect(page.getByText(/won't count toward their 1099-NEC/)).toBeVisible();
  await page.getByLabel("Payment method").selectOption("zelle");
  await expect(page.getByText("This payment counts toward the contractor's 1099-NEC.")).toBeVisible();
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Expense saved.")).toBeVisible();

  await page.goto(mariaUrl);
  await expect(page.getByText("Unpaid").first().locator("..")).toContainText("$0.00");
  await expect(page.getByText(/on the 1099-NEC$/).first().locator("..")).toContainText("$150.00");
});

test("documents: a W-9 upload is kept and logged; staff can't open it", async ({ page, browser }) => {
  await page.goto(mariaUrl);
  await page.getByLabel("Document").selectOption("w9");
  await page.getByLabel("PDF or photo").setInputFiles({ name: "w9.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Document saved.")).toBeVisible();
  const link = page.getByRole("link", { name: "w9.pdf" });
  const href = (await link.getAttribute("href"))!;
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");

  const staff = await browser.newContext({ storageState: "tests/e2e/.auth/staff.json" });
  const s = await staff.newPage();
  expect((await s.request.get(href)).status()).toBe(403);
  await s.goto(mariaUrl);
  await expect(s.getByText("You can't see contractors")).toBeVisible();
  await s.goto("/finances/1099s");
  await expect(s.getByText("You can't see 1099s")).toBeVisible();
  // staff can still book, so they see who can clean
  await s.goto("/appointments/new");
  await s.locator("#contractorIds").click();
  await expect(s.getByRole("option", { name: "E2E Maria Silva" })).toBeVisible();
  await staff.close();
});

test("the 1099 page and export: masked by default, full tax IDs only with a code", async ({ page }) => {
  const year = today.slice(0, 4);
  await page.goto(`/finances/1099s?year=${year}`);
  const row = page.getByRole("row").filter({ hasText: "Silva, E2E Maria" });
  await expect(row).toContainText("$150.00");
  await expect(row).toContainText("•••-••-6789");
  await expect(row).toContainText(/Under \$/);

  await page.getByLabel("Include everyone").check();
  const [masked] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  const maskedText = readFileSync((await masked.path())!, "utf8");
  expect(maskedText).toContain("***6789");
  expect(maskedText).not.toContain("123-45-6789");

  await page.getByLabel("Include full tax ID numbers").check();
  await page.getByLabel("Code from your authenticator app").fill("123456");
  await page.getByRole("button", { name: "Download CSV" }).click();
  await expect(page.getByText(/That code isn't right/)).toBeVisible();
  let fullText = "";
  await submitWithCode(
    page,
    async () => {
      const download = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
      await page.getByRole("button", { name: "Download CSV" }).click();
      const file = await download;
      if (file) fullText = readFileSync((await file.path())!, "utf8");
    },
    async () => fullText !== "",
  );
  expect(fullText).toContain('"123-45-6789"');
  expect(fullText).toContain('"Silva"');
  expect(fullText).toContain("150.00");
});

test("booking: red outlines, the month calendar, more than one vehicle, and a summary with the day to confirm", async ({ page }) => {
  const fx = fixtures();
  await page.goto(`/appointments/new?customer=${fx.customers.PLAIN.id}`);
  await page.waitForLoadState("networkidle");
  // no status or price to set: new ones are pending, priced by their invoice
  await expect(page.getByLabel("Status")).toHaveCount(0);
  await expect(page.getByLabel(/Price/)).toHaveCount(0);
  // nothing picked: red outlines (the invoice too), no summary
  await page.getByRole("button", { name: "Book appointment" }).click();
  await expect(page.getByText("Fill in the fields outlined in red.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Vehicles" })).toHaveClass(/ring-destructive/);
  // booked against an open invoice on their account ($99, made for this test)
  const invoice = fixture<{ id: number }>("open-invoice", String(fx.customers.PLAIN.id), "9900");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await pickInvoice(page, invoice.id);
  await expect(page.getByRole("button", { name: "Confirm and book" })).toHaveCount(0);

  // the calendar steps through months; the times appear once a day is picked
  const monthTitle = page.getByText(/^[A-Z][a-z]+ \d{4}$/).first();
  const thisMonth = await monthTitle.textContent();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(monthTitle).not.toHaveText(thisMonth!);
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(monthTitle).toHaveText(thisMonth!);
  await expect(page.getByLabel("Start")).toHaveCount(0);
  const day = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  await page.getByRole("button", { name: new RegExp(`^${day}`) }).click();
  await page.getByLabel("Start").fill("11:30");
  await page.getByRole("button", { name: "1 h", exact: true }).click();
  await expect(page.getByLabel("End")).toHaveValue("12:30");

  // two vehicles (when there are two)
  const vans = page.getByRole("group", { name: "Vehicles" }).getByRole("button");
  const two = (await vans.count()) >= 2;
  await vans.first().click();
  if (two) await vans.nth(1).click();
  await page.locator("#contractorIds").click();
  await page.getByRole("option", { name: "E2E Maria Silva" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  // the summary, and the day: the 9–11 visit booked earlier, and this one
  await page.getByRole("button", { name: "Book appointment" }).click();
  const sheet = page.getByRole("alertdialog");
  await expect(sheet.getByText("Book this appointment?")).toBeVisible();
  await expect(sheet.getByText("11:30 AM – 12:30 PM").first()).toBeVisible();
  await expect(sheet.getByText("$99.00")).toBeVisible(); // the invoice it's booked against
  const schedule = sheet.getByRole("list", { name: "That day's schedule" });
  await expect(schedule.getByRole("listitem").filter({ hasText: "New:" })).toContainText("11:30 AM – 12:30 PM");
  await expect(schedule.getByRole("listitem").filter({ hasText: "9:00 AM – 11:00 AM" })).toBeVisible();
  await sheet.getByRole("button", { name: "Confirm and book" }).click();

  await expect(page).toHaveURL(/\/appointments\/\d+\?saved=created/);
  await expect(page.getByText("Pending").first()).toBeVisible();
  if (two) await expect(page.getByText("Vehicles", { exact: true }).filter({ visible: true })).toHaveCount(1);
  // priced by its invoice, which is now linked to the visit
  await expect(page.getByText("$99.00").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /\$99\.00 \(open\)/ })).toBeVisible();
  // it doesn't count as a day worked until completed: cancel it so the pay stays the same
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel appointment" }).click();
  await expect(page).toHaveURL(/saved=canceled/);
});

test("recurring: an expected visit becomes a draft invoice and a booking; once done, the owner is told to finalize it", async ({ page }) => {
  const fx = fixtures();
  fixture("memorize", String(fx.customers.PLAIN.id));
  await page.goto(`/customers/${fx.customers.PLAIN.id}`);
  const recurring = page.locator("#recurring");
  await expect(recurring.getByText("Every 2 weeks").first()).toBeVisible();
  await expect(recurring.getByText("$135.00").first()).toBeVisible();
  const first = recurring.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Invoice & book" }) }).first();
  const firstDay = (await first.textContent())!.split(" · ")[0];

  // Invoice & book: a draft from the memorized invoice, and the booking form filled in
  await first.getByRole("button", { name: "Invoice & book" }).click();
  await expect(page).toHaveURL(/\/appointments\/new\?.*invoice=\d+/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("radio", { name: /^Draft · \$135\.00/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Start")).toBeVisible(); // the day is picked
  await page.getByRole("group", { name: "Vehicles" }).getByRole("button").first().click();
  await page.locator("#contractorIds").click();
  await page.getByRole("option", { name: "E2E Maria Silva" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Book appointment" }).click();
  await page.getByRole("button", { name: "Confirm and book" }).click();
  await expect(page).toHaveURL(/\/appointments\/\d+\?saved=created/);
  await expect(page.getByRole("link", { name: /Draft · \$135\.00 \(draft\)/ })).toBeVisible();
  const visit = page.url().replace(/\?.*$/, "");

  // that visit is booked now: the next one expected is two weeks after it
  await page.goto(`/customers/${fx.customers.PLAIN.id}`);
  await expect(page.locator("#recurring").getByText(firstDay)).toHaveCount(0);

  // done, but its invoice is still a draft: the owner hears about it and it's on the list
  await page.goto(visit);
  await page.getByRole("button", { name: "Mark completed" }).click();
  await expect(page).toHaveURL(/saved=completed/);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(page.getByRole("link", { name: /Finalize the invoice: Plain Test/ }).first()).toBeVisible();
  await page.goto("/finances?tab=to_finalize");
  await expect(page.getByRole("link", { name: /To finalize/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("$135.00").filter({ visible: true }).first()).toBeVisible();
});

test("booking a recurring customer bills their recurring invoice by default; the draft is made only when it's booked", async ({ page }) => {
  const fx = fixtures();
  const drafts = () => fixture<{ status: string; total: number }[]>("stripe-invoices", String(fx.customers.PLAIN.id)).filter((i) => i.status === "draft" && i.total === 13500).length;
  const before = drafts();
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  await page.goto(`/appointments/new?customer=${fx.customers.PLAIN.id}&date=${tomorrow}`);
  await page.waitForLoadState("networkidle");
  // no invoice to pick: the recurring one is used
  await expect(page.getByText(/^Recurring invoice · Every 2 weeks · \$135\.00/)).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Invoice" })).toHaveCount(0);
  // other ways to bill are one click away, and back
  await page.getByRole("button", { name: "Bill this visit differently" }).click();
  await expect(page.getByRole("radiogroup", { name: "Invoice" }).or(page.getByText(/No draft or open invoices/))).toBeVisible();
  await page.getByRole("button", { name: /^Use the recurring invoice/ }).click();
  await expect(page.getByText(/^Recurring invoice · Every 2 weeks/)).toBeVisible();

  await page.getByLabel("Start").fill("14:00");
  await page.getByRole("group", { name: "Vehicles" }).getByRole("button").first().click();
  await page.locator("#contractorIds").click();
  await page.getByRole("option", { name: "E2E Maria Silva" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Book appointment" }).click();
  const sheet = page.getByRole("alertdialog");
  await expect(sheet.getByText("Recurring · $135.00")).toBeVisible();
  // backing out of the summary makes nothing
  await sheet.getByRole("button", { name: "Go back" }).click();
  expect(drafts()).toBe(before);

  await page.getByRole("button", { name: "Book appointment" }).click();
  await page.getByRole("button", { name: "Confirm and book" }).click();
  await expect(page).toHaveURL(/\/appointments\/\d+\?saved=created/);
  await expect(page.getByRole("link", { name: /Draft · \$135\.00 \(draft\)/ })).toBeVisible();
  expect(drafts()).toBe(before + 1);
});

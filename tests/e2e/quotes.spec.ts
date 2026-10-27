// Estimates: build from the price list, send, and the customer's side: view,
// confirm identity, consent, sign, accept (or decline). Acceptance makes a
// draft invoice, notifies staff and can't be altered.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { fixture, fixtures } from "./support/helpers";

test.use({ storageState: "tests/e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

let quoteUrl = "";
let quoteId = 0;
let quoteNumber = 0;

type Home = { bedrooms?: number; bathrooms?: number; sqft?: string; cleaning: RegExp[]; extras?: RegExp[]; every?: RegExp };

// Fill in the quick estimate: tiles for the type of cleaning and extras.
async function fillEstimate(page: Page, h: Home) {
  const fx = fixtures();
  await page.goto(`/finances/estimates/new?customer=${fx.customers.PLAIN.id}`);
  await expect(page).toHaveURL(/\/finances\/estimates\/quick\?customer=/);
  await page.waitForLoadState("networkidle");
  for (const t of h.cleaning) await page.getByRole("button", { name: t }).click();
  // the form starts at 2 bedrooms
  for (let i = 2; i < (h.bedrooms ?? 2); i++) await page.getByRole("button", { name: "More bedrooms" }).click();
  if (h.sqft) await page.getByLabel("Square feet").selectOption({ label: h.sqft });
  for (let i = 1; i < (h.bathrooms ?? 1); i++) await page.getByRole("button", { name: "More bathrooms" }).click();
  for (const x of h.extras ?? []) await page.getByRole("button", { name: x }).click();
  if (h.every) await page.getByRole("radio", { name: h.every }).click();
}

async function newEstimate(page: Page, h: Home) {
  await fillEstimate(page, h);
  await page.getByRole("button", { name: "Create estimate" }).click();
  await expect(page.getByText("Estimate saved.")).toBeVisible();
  const id = Number(/estimates\/(\d+)/.exec(page.url())![1]);
  const heading = (await page.getByRole("heading", { level: 1 }).textContent())!;
  const number = Number(/#(\d+)/.exec(heading)![1]);
  // the link in the share panel; copying it marks the estimate sent
  const url = (await page.locator(".font-mono", { hasText: "/q/" }).first().textContent())!.trim();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sent");
  return { id, number, url };
}

const standard = { cleaning: [/^Standard cleaning/] };

async function asCustomer(browser: Browser, url: string) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

test("an estimate from the price list: deep clean first, then standard cleanings every 2 weeks", async ({ page }) => {
  await fillEstimate(page, { bedrooms: 3, bathrooms: 2, sqft: "1,501–2,000 sq ft", cleaning: [/^Deep clean/, /^Standard cleaning/], extras: [/^Inside the fridge/] });
  await expect(page.getByRole("button", { name: /^Deep clean/ })).toHaveAttribute("aria-pressed", "true");
  // deep + standard: every 2 weeks is picked, and has to be confirmed
  // one card per frequency with its discount; no "None" for this plan
  const cards = page.getByRole("radiogroup", { name: "Recurring Cleaning Frequency" }).getByRole("radio");
  await expect(cards).toHaveText([/Weekly\s*20% off/, /Every 2 weeks\s*10% off/, /Monthly\s*5% off/]);
  await expect(cards.filter({ hasText: "$" })).toHaveCount(0);
  const biweekly = page.getByRole("radio", { name: /^Every 2 weeks/ });
  await expect(biweekly).toHaveAttribute("aria-checked", "false"); // suggested, not yet confirmed
  await expect(page.getByText("Suggested", { exact: true })).toBeVisible();
  await expect(page.getByText("Please confirm frequency of cleanings")).toBeVisible();
  await expect(page.getByText("$270.00").first()).toBeVisible(); // already priced at every 2 weeks
  await expect(page.getByRole("button", { name: "Create estimate" })).toBeDisabled();
  await biweekly.click();
  await expect(biweekly).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Suggested", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Please confirm/)).toHaveCount(0);
  await expect(page.getByLabel(/Valid until/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create estimate" })).toBeEnabled();
  // 3 BR $210 + size $30 = $240, 2 baths $60, deep +$175, fridge $45 = $520; then $300 − 10%
  await expect(page.getByText("$520.00").first()).toBeVisible();
  await expect(page.getByText("$270.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Create estimate" }).click();
  await expect(page.getByText("Estimate saved.")).toBeVisible();
  quoteId = Number(/estimates\/(\d+)/.exec(page.url())![1]);
  quoteNumber = Number(/#(\d+)/.exec((await page.getByRole("heading", { level: 1 }).textContent())!)![1]);
  quoteUrl = (await page.locator(".font-mono", { hasText: "/q/" }).first().textContent())!.trim();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sent");

  expect(quoteNumber).toBeGreaterThanOrEqual(10490);
  await expect(page.getByText("ESTIMATE", { exact: true }).first()).toBeVisible();
  // the estimate shows what's covered, not the price breakdown
  await expect(page.getByText("Your home: 3 bedrooms, 2 bathrooms.").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("3 bedrooms $240").filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("First Visit: Deep Clean").filter({ visible: true }).first()).toBeVisible();
  // sent today, so good for two weeks from today
  // (calendar days from today in Eastern time, so a clock change in between doesn't matter)
  const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const in2Weeks = new Date(Date.parse(`${todayET}T12:00:00Z`) + 14 * 86_400_000).toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "medium" });
  await expect(page.getByText(`good until ${in2Weeks}`)).toBeVisible();
  await expect(page.getByText(/sq ft/).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("Every 2 weeks").first()).toBeVisible();
  expect(quoteUrl).toMatch(/\/q\/[0-9a-f]{64}$/);
});

test("staff opening the link see a preview and can't accept for the customer", async ({ page }) => {
  await page.goto(quoteUrl);
  await expect(page.getByText(/this is a preview/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept and sign/ })).toHaveCount(0);
});

test("the customer must confirm who they are, sign and consent; then it's accepted", async ({ browser, page }) => {
  const { ctx, page: c } = await asCustomer(browser, quoteUrl);
  await expect(c.getByText(`${quoteNumber}`, { exact: true })).toBeVisible();
  // their contact details aren't on the public page
  await expect(c.getByText("stripetest1@example.com")).toHaveCount(0);

  await expect(c.getByText(/Sales tax/)).toHaveCount(0);
  await expect(c.getByRole("button", { name: /Accept and sign · \$520\.00/ })).toBeVisible();
  await c.getByLabel("Your email address").fill("someone@else.com");
  await c.getByLabel("Type your full name").fill("Plain Test");
  // one box covers accepting and signing electronically; the details fold away
  await expect(c.getByRole("checkbox")).toHaveCount(1);
  await c.getByText("What you're agreeing to").click();
  await expect(c.getByText(/free paper copy/)).toBeVisible();
  await c.getByRole("checkbox", { name: /I accept this estimate.*sign and receive records electronically/ }).check();
  await c.getByRole("button", { name: /Accept and sign/ }).click();
  await expect(c.getByText("That doesn't match the email we have for you.")).toBeVisible();

  await c.getByLabel("Your email address").fill("STRIPETEST1@example.com");
  await c.getByRole("button", { name: /Accept and sign/ }).click();
  // the page switches to the record of what was accepted
  await expect(c.getByRole("heading", { name: "Accepted" })).toBeVisible();
  await expect(c.getByRole("definition").filter({ hasText: "Plain Test" })).toBeVisible();
  await expect(c.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
  await ctx.close();

  // staff: a notification, the acceptance record, and two draft invoices:
  // the first visit and one recurring visit
  await page.goto("/finances/estimates");
  await page.getByRole("button", { name: /Notifications, \d+ unread/ }).click();
  await expect(page.getByRole("link", { name: new RegExp(`Estimate #${quoteNumber} accepted by`) })).toBeVisible();
  await page.goto(`/finances/estimates/${quoteId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Accepted: to schedule");
  await expect(page.getByText("Confirmed email on file")).toBeVisible();
  await expect(page.getByText(/can't be changed or deleted/)).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("link", { name: /^First visit invoice/ })).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole("link", { name: /^Recurring invoice · every 2 weeks/ })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 90_000 });
  const estimatePage = page.url();
  await page.getByRole("link", { name: /^First visit invoice/ }).click();
  await expect(page).toHaveURL(/\/finances\/invoices\/\d+/);
  await expect(page.getByText("$520.00").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/First Visit: Deep Clean: 3 bedrooms/).filter({ visible: true }).first()).toBeVisible();
  await page.goto(estimatePage);
  // the recurring plan is the customer's memorized invoice (no draft yet: each
  // visit gets one when it's booked)
  await page.getByRole("link", { name: /^Recurring invoice/ }).click();
  await expect(page).toHaveURL(/\/customers\/\d+#recurring$/);
  const recurring = page.locator("#recurring");
  await expect(recurring.getByText("Every 2 weeks").first()).toBeVisible();
  await expect(recurring.getByText("$270.00").first()).toBeVisible();
  await expect(recurring.getByText(/Standard cleaning, every 2 weeks: 10% off/)).toBeVisible();

  // the estimates list: filter pills (blue when chosen), search, the whole row opens it
  await page.goto("/finances/estimates");
  await page.getByRole("navigation", { name: "Estimate filters" }).getByRole("link", { name: /^Accepted/ }).click();
  await expect(page).toHaveURL(/tab=accepted/);
  await expect(page.getByRole("navigation", { name: "Estimate filters" }).getByRole("link", { name: /^Accepted/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: `#${quoteNumber}`, exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search estimates" }).fill(String(quoteNumber));
  await page.getByRole("searchbox", { name: "Search estimates" }).press("Enter");
  await expect(page).toHaveURL(new RegExp(`q=${quoteNumber}`));
  await expect(page.getByRole("link", { name: `#${quoteNumber}`, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Price list" }).first()).toBeVisible(); // in the sidebar now

  // and the lead/customer can't be deleted while it has estimates; the record can't be changed
  const tamper = fixture<{ refused: boolean; message?: string }>("tamper-acceptance", String(quoteId));
  expect(tamper.refused).toBe(true);
  expect(tamper.message).toMatch(/can't be changed or deleted/);
});

test("an estimate changed after the customer opened it can't be accepted from the old page", async ({ browser, page }) => {
  const q = await newEstimate(page, standard);
  const { ctx, page: c } = await asCustomer(browser, q.url);

  // staff raise the price meanwhile
  await page.goto(`/finances/estimates/${q.id}/edit`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Option 1 price").fill("190");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByText("version 2")).toBeVisible();

  await c.getByLabel("Your email address").fill("stripetest1@example.com");
  await c.getByLabel("Type your full name").fill("Plain Test");
  await c.getByRole("checkbox", { name: /I accept this estimate/ }).check();
  await c.getByRole("button", { name: /Accept and sign/ }).click();
  await expect(c.getByText(/was just updated. Reload/)).toBeVisible();
  await c.reload();
  await c.waitForLoadState("networkidle");
  await expect(c.getByText("$190.00").first()).toBeVisible();
  await ctx.close();
});

test("five wrong identity checks pause acceptance", async ({ browser }) => {
  const { number } = { number: quoteNumber + 1 };
  const t = fixture<{ id: number; token: string }>("quote-token", String(number));
  const { ctx, page: c } = await asCustomer(browser, `/q/${t.token}`);
  await c.getByLabel("Type your full name").fill("Plain Test");
  await c.getByRole("checkbox", { name: /I accept this estimate/ }).check();
  for (let i = 0; i < 5; i++) {
    await c.getByLabel("Your email address").fill(`wrong${i}@example.com`);
    await c.getByRole("button", { name: /Accept and sign/ }).click();
    await expect(c.locator('p[role="alert"]')).toContainText(i < 4 ? "doesn't match" : "paused this for an hour");
  }
  await c.getByLabel("Your email address").fill("stripetest1@example.com");
  await c.getByRole("button", { name: /Accept and sign/ }).click();
  await expect(c.locator('p[role="alert"]')).toContainText("Too many tries");
  await ctx.close();
});

test("the customer can decline, with a reason, and staff are told", async ({ browser, page }) => {
  const q = await newEstimate(page, standard);
  const { ctx, page: c } = await asCustomer(browser, q.url);
  await c.getByRole("button", { name: /Decline this estimate/ }).click();
  await c.getByLabel("Mind telling us why?").selectOption("Price");
  await c.getByRole("button", { name: "Decline the estimate" }).click();
  await expect(c.getByText(/Thanks for letting us know|You declined this estimate/)).toBeVisible();
  await ctx.close();
  await page.goto(`/finances/estimates/${q.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Declined");
  await expect(page.getByText("Declined: Price")).toBeVisible();
  await page.goto("/reports?tab=estimates");
  await expect(page.getByRole("heading", { name: "Why customers declined" })).toBeVisible();
});

test("the message always carries the estimate's current link", async ({ page }) => {
  const visible = (l: ReturnType<Page["locator"]>) => l.filter({ visible: true }).first();
  const linkInMessage = () => visible(page.locator(".font-mono", { hasText: "/q/" }));
  const current = async () => (await visible(page.getByRole("link", { name: "Open as the customer sees it" })).getAttribute("href"))!;
  const first = await newEstimate(page, standard);
  await expect(linkInMessage()).toHaveText(first.url);
  await expect(visible(page.getByText(/Here's your cleaning estimate from/))).toBeVisible();

  // a new link: the message switches to it
  await page.getByRole("button", { name: "New link" }).click();
  await page.getByRole("button", { name: "Make new link" }).click();
  await expect(async () => expect(await current()).not.toBe(first.url)).toPass();
  await expect(linkInMessage()).toHaveText(await current());
  await expect(page.getByText(first.url).filter({ visible: true })).toHaveCount(0); // the old one is gone

  // another estimate opened from here gets its own link in the message
  await page.getByRole("button", { name: "Duplicate" }).click();
  await page.getByRole("button", { name: "Duplicate" }).last().click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  const copy = await current();
  await expect(linkInMessage()).toHaveText(copy);
  await expect(visible(page.getByText(/Here's your cleaning estimate from/))).not.toContainText(first.url);
});

test("a made-up link shows nothing", async ({ browser }) => {
  const { ctx, page: c } = await asCustomer(browser, `/q/${"a".repeat(64)}`);
  await expect(c.getByText(/isn't available/)).toBeVisible();
  await ctx.close();
});

test("move-in / move-out: no deep clean; recurring only as standard cleanings, how often required", async ({ page }) => {
  await fillEstimate(page, { cleaning: [/^Move-in \/ move-out/], extras: [/^Extra rooms/] });
  await expect(page.getByRole("button", { name: /^Deep clean/ })).toBeDisabled();
  // on its own it's one-time: no frequency to pick
  await expect(page.getByRole("radiogroup", { name: "Recurring Cleaning Frequency" })).toHaveCount(0);
  await expect(page.getByText(/A move-in \/ move-out clean is one-time/)).toBeVisible();
  // per-room extras count up
  await page.getByRole("button", { name: "More rooms" }).click();
  await expect(page.getByText("Extra rooms × 2").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create estimate" })).toBeEnabled();

  // with standard: every frequency, no "None", every 2 weeks suggested until confirmed
  await page.getByRole("button", { name: /^Standard cleaning/ }).click();
  const cards = page.getByRole("radiogroup", { name: "Recurring Cleaning Frequency" }).getByRole("radio");
  await expect(cards).toHaveText([/Weekly/, /Every 3 weeks/, /Every 2 weeks/, /Monthly/]);
  await expect(page.getByText("Please confirm frequency of cleanings")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create estimate" })).toBeDisabled();
  await page.getByRole("radio", { name: /^Every 3 weeks/ }).click();
  await expect(page.getByText(/Please confirm/)).toHaveCount(0);
  // 2 BR $155 + 1 bath $30 + move +$210 + 2 rooms $50 = $445; then $185 − 15%
  await expect(page.getByText("$445.00").first()).toBeVisible();
  await expect(page.getByText("$157.25").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create estimate" })).toBeEnabled();
});

test("a deep clean on its own: one-time or monthly", async ({ page }) => {
  await fillEstimate(page, { cleaning: [/^Deep clean/] });
  const cards = page.getByRole("radiogroup", { name: "Recurring Cleaning Frequency" }).getByRole("radio");
  await expect(cards).toHaveText([/None/, /Monthly/]);
  await expect(page.getByRole("radio", { name: /^None/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: /^Monthly/ }).click();
  // 2 BR $155 + 1 bath $30 + deep $175 = $360; repeated monthly at 5% off
  await expect(page.getByText("$342.00").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create estimate" })).toBeEnabled();
});

test("new extras with an icon from the price list show up as cards", async ({ page }) => {
  await page.goto("/finances/estimates/pricing");
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("3 bedroom price")).toHaveValue("210.00");
  await page.getByRole("button", { name: "Add an extra" }).click();
  await page.getByLabel("Extra 6 name").fill("E2E inside windows");
  await page.getByLabel("E2E inside windows price").fill("40");
  await page.getByRole("button", { name: /E2E inside windows: Sparkles\. Change icon/ }).click();
  await page.getByRole("option", { name: "Windows", exact: true }).click();
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText(/Prices saved/)).toBeVisible();

  await page.goto("/finances/estimates/quick");
  await page.waitForLoadState("networkidle");
  const card = page.getByRole("button", { name: /^E2E inside windows \$40/ });
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");

  // put the price list back
  await page.goto("/finances/estimates/pricing");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Remove E2E inside windows" }).click();
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText(/Prices saved/)).toBeVisible();
});

// Attacks found in security sweeps, kept as tests so they stay fixed.
import { expect, test } from "@playwright/test";
import { enterPassword, fixture, fixtures, freshStep, submitCode, totp } from "./support/helpers";

test.afterEach(() => {
  const fx = fixtures();
  fixture("unlock", fx.owner.email);
  fixture("unlock", fx.staff.email);
});

test("a sign-in link can't send people to another site afterwards", async ({ page }) => {
  const fx = fixtures();
  for (const next of ["/\t/evil.example", "/\n/evil.example", "//evil.example", "/\\evil.example", "https://evil.example"]) {
    await page.context().clearCookies();
    await page.route("**://evil.example/**", (r) => r.fulfill({ status: 200, body: "fake page", contentType: "text/html" }));
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.locator("#email").fill(fx.owner.email);
    await page.locator("#password").fill(fx.owner.password);
    await page.locator("#password").press("Enter");
    await expect(page).toHaveURL(/\/login\/verify/);
    await freshStep();
    await submitCode(page, totp(fx.owner.secret!, next.length % 2));
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).host, JSON.stringify(next)).toBe(new URL(test.info().project.use.baseURL!).host);
    fixture("unlock", fx.owner.email);
    // each sign-in used a code; let the next one have its own step
    await page.waitForTimeout(31_000);
  }
});

test("a stranger who knows the email can't lock the owner out", async ({ browser }) => {
  const fx = fixtures();
  const attacker = await (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.5" } })).newPage();
  for (let i = 0; i < 7; i++) {
    await attacker.goto("/login");
    await attacker.locator("#email").fill(fx.owner.email);
    await attacker.locator("#password").fill(`wrong-${i}`);
    await attacker.locator("#password").press("Enter");
    // a wrong password stays on the page with a message
    await expect(attacker.getByRole("alert").filter({ hasText: /incorrect|Too many|isn't right/i })).toBeVisible();
  }
  await expect(attacker.getByRole("alert").filter({ hasText: "Too many" })).toBeVisible();
  const owner = await (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.7" } })).newPage();
  await enterPassword(owner, fx.owner.email, fx.owner.password);
  await expect(owner).toHaveURL(/\/login\/verify/);
  await attacker.context().close();
  await owner.context().close();
});

test.describe("as staff", () => {
  test.use({ storageState: "tests/e2e/.auth/staff.json" });

  test("can't link a customer to a Stripe account by editing the form", async ({ page }) => {
    const fx = fixtures();
    const customer = fx.customers.OTHER;
    await page.goto(`/customers/${customer.id}/edit`);
    await expect(page.locator('main textarea[name="notes"]')).toBeVisible();
    await expect(page.locator('input[name="stripeCustomerId"]')).toHaveCount(0);
    // add the field by hand, as an attacker would, and save
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.name = "stripeCustomerId";
      input.value = "cus_someoneelse12345";
      document.querySelector("main form")!.appendChild(input);
      const notes = document.querySelector('textarea[name="notes"]') as HTMLTextAreaElement;
      notes.value = `${notes.value} edited`;
      notes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // the customer form's Save (the header's Sign out is a form too)
    await page.locator('main form button[type="submit"]').first().click();
    const confirm = page.getByRole("button", { name: /save|confirm/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    // it saved (as staff), and the Stripe link didn't change
    await expect(page).toHaveURL(/\/customers\/\d+\?saved=updated/);
    expect(fixture<{ stripeCustomerId: string }>("customer", String(customer.id)).stripeCustomerId).toBe(customer.stripe);
  });
});

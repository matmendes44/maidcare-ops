// Sign-in security: two-step login, recovery codes, lockouts, roles and the
// Users page.
import { expect, test } from "@playwright/test";
import { enterPassword, fixture, fixtures, freshStep, newContext, newInvoice, openCharge, submitCode, totp } from "./support/helpers";

type NewUser = { id: number; email: string; password: string };

// wrong guesses in one test must not trip the sign-in limit for the next
test.afterEach(() => {
  const fx = fixtures();
  fixture("unlock", fx.owner.email);
  fixture("unlock", fx.staff.email);
});

test.describe("two-step login", () => {
  test("first sign-in sets it up; later sign-ins need a fresh code or a recovery code", async ({ page, request }) => {
    const user = fixture<NewUser>("user-new", "e2e-enroll@example.invalid", "E2E Enroll");
    await enterPassword(page, user.email, user.password);
    await expect(page).toHaveURL(/\/login\/setup/);
    // no session until the code is confirmed
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const home = await request.get("/", { headers: { cookie }, maxRedirects: 0 });
    expect(home.status()).toBeGreaterThanOrEqual(300);
    await expect(page.getByAltText(/QR code/)).toBeVisible();
    await page.getByText("Can't scan it? Enter this key instead").click();
    const secret = (await page.locator("details code").innerText()).replace(/\s/g, "");

    await submitCode(page, "000000");
    await expect(page.getByRole("alert").filter({ hasText: "doesn't match" })).toBeVisible();
    await freshStep();
    const firstCode = totp(secret);
    await submitCode(page, firstCode);
    const codes = await page.getByLabel("Recovery codes").locator("li").allInnerTexts();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    const proceed = page.getByRole("link", { name: "Continue" });
    await expect(proceed).toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("I've saved these codes").check();
    await proceed.click();
    await expect(page).toHaveURL((u) => u.pathname === "/");
    const stored = fixture<{ totpSecret: string }>("user", user.email);
    expect(stored.totpSecret.startsWith("v1:")).toBe(true);
    expect(stored.totpSecret).not.toContain(secret);

    // the same code can't be used again
    await page.context().clearCookies();
    await enterPassword(page, user.email, user.password);
    await expect(page).toHaveURL(/\/login\/verify/);
    await submitCode(page, firstCode);
    await expect(page.getByRole("alert").filter({ hasText: "isn't right" })).toBeVisible();
    await submitCode(page, totp(secret, 1));
    await expect(page).toHaveURL((u) => u.pathname === "/");

    // a recovery code works once
    for (const expectOk of [true, false]) {
      await page.context().clearCookies();
      await enterPassword(page, user.email, user.password);
      await page.getByRole("button", { name: "Lost your phone? Use a recovery code" }).click();
      await submitCode(page, codes[0]);
      if (expectOk) await expect(page).toHaveURL((u) => u.pathname === "/");
      else await expect(page.getByRole("alert").filter({ hasText: "already used" })).toBeVisible();
    }
    expect(fixture<{ codes_left: number }>("user-counts", user.email).codes_left).toBe(9);
  });

  test("five wrong codes end the sign-in; even a right code is then refused", async ({ page }) => {
    const fx = fixtures();
    fixture("unlock", fx.owner.email);
    await enterPassword(page, fx.owner.email, fx.owner.password);
    await expect(page).toHaveURL(/\/login\/verify/);
    for (let i = 0; i < 5; i++) await submitCode(page, "222222");
    await expect(page.getByRole("alert").filter({ hasText: "Too many wrong codes" })).toBeVisible();
    await page.goto("/login/verify");
    await expect(page.locator("#code")).toHaveCount(0);
    await expect(page.locator("main")).toContainText("Too many wrong codes");
    fixture("unlock", fx.owner.email);
  });

  test("the code pages need a password first", async ({ page }) => {
    await page.goto("/login/verify");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/login/setup");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("roles", () => {
  test("staff don't get money, delete or user-management actions", async ({ browser }) => {
    const fx = fixtures();
    const owner = await (await newContext(browser, "owner")).newPage();
    const r = await newInvoice(owner, fx.customers.OTHER.id, [["Clean", "1", "77"]]);

    const staff = await (await newContext(browser, "staff")).newPage();
    await staff.goto(`/finances/invoices/${r.id}`);
    await expect(staff.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(staff.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    for (const name of ["Charge", "Finalize", "Delete draft"]) await expect(staff.getByRole("button", { name, exact: true })).toHaveCount(0);
    await staff.goto(`/customers/${fx.customers.OTHER.id}`);
    await expect(staff.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await staff.goto("/settings/users");
    await expect(staff.locator("body")).toContainText(/could not be found|404/i);
    await expect(staff.locator("body")).not.toContainText("e2e-owner@example.invalid");
    const connect = await staff.request.get("/api/bouncie/connect", { maxRedirects: 0 });
    expect(connect.headers().location ?? "").toContain("bouncie=forbidden");

    // calling the charge action directly as staff is refused
    await openCharge(owner, r.id!);
    await owner.locator('input[aria-label="Paid another way"]').check();
    await owner.getByRole("button", { name: "Cash", exact: true }).click();
    let body = "";
    let headers: Record<string, string> = {};
    await owner.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"] && !body) {
        body = req.postData() ?? "";
        headers = req.headers();
        await route.abort();
      } else await route.continue();
    });
    await owner.getByRole("button", { name: /^Mark \$/ }).click();
    await expect.poll(() => body.length > 0).toBe(true);
    await owner.unroute("**/*");
    const staffCookie = (await staff.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const asStaff = await staff.request.post(`/finances/invoices/${r.id}`, {
      headers: { ...headers, cookie: staffCookie, origin: new URL(owner.url()).origin, "content-length": undefined as unknown as string },
      data: Buffer.from(body),
    });
    expect(await asStaff.text()).toContain("You don't have permission");
    expect(fixture<{ status: string }>("invoice", String(r.id)).status).toBe("draft");
    await owner.context().close();
    await staff.context().close();
  });
});

test.describe("users page", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("the owner adds people, resets two-step login and disables accounts", async ({ page, browser }) => {
    // a staff member who's signed in
    const member = fixture<NewUser>("user-new", "e2e-member@example.invalid", "E2E Member");
    const memberPage = await (await browser.newContext()).newPage();
    await enterPassword(memberPage, member.email, member.password);
    await memberPage.getByText("Can't scan it? Enter this key instead").click();
    const secret = (await memberPage.locator("details code").innerText()).replace(/\s/g, "");
    await freshStep();
    await submitCode(memberPage, totp(secret));
    await memberPage.getByLabel("I've saved these codes").check();
    await memberPage.getByRole("link", { name: "Continue" }).click();
    await expect(memberPage).toHaveURL((u) => u.pathname === "/");

    await page.goto("/settings/users");
    await expect(page.locator("main")).toContainText("E2E Member");
    // adding someone
    await page.locator("#new-name").fill("E2E Added");
    await page.locator("#new-email").fill("e2e-added@example.invalid");
    await page.locator("#new-password").fill("E2eAddedPassword1!");
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("status").filter({ hasText: "can now sign in" })).toBeVisible();
    expect(fixture<{ role: string }>("user", "e2e-added@example.invalid").role).toBe("staff");

    page.on("dialog", (d) => d.accept());
    const row = page.locator("main tbody tr", { hasText: "E2E Member" });
    await row.getByRole("button", { name: "Reset 2FA" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Two-step login reset" })).toBeVisible();
    expect(fixture<{ totpSecret: string | null }>("user", member.email).totpSecret).toBeNull();
    await memberPage.goto("/");
    await expect(memberPage).toHaveURL(/\/login/);

    await page.locator("main tbody tr", { hasText: "E2E Member" }).getByRole("button", { name: "Disable" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Account disabled" })).toBeVisible();
    await enterPassword(memberPage, member.email, member.password);
    await expect(memberPage).toHaveURL(/\/login$/);
    // nobody can change their own role or disable themselves here
    await expect(page.locator("main tbody tr", { hasText: "(you)" }).locator("button, select")).toHaveCount(0);
    await memberPage.context().close();
  });

  test("new recovery codes need a current code", async ({ page }) => {
    const fx = fixtures();
    await page.goto("/settings");
    await expect(page.locator("main")).toContainText("Two-step login is on");
    await page.getByRole("button", { name: "Make new recovery codes" }).click();
    await freshStep();
    await page.locator("#recovery-code").fill(totp(fx.owner.secret!, 1));
    await page.getByRole("button", { name: "Make new codes" }).click();
    await expect(page.locator("main")).toContainText("New recovery codes");
    expect(fixture<{ codes_left: number }>("user-counts", fx.owner.email).codes_left).toBe(10);
  });
});

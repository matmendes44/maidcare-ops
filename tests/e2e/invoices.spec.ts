// Money: what's typed is exactly what's billed, an invoice is never charged
// twice or for an amount nobody confirmed, and server actions can't be
// abused by calling them directly.
import { expect, test, type Page, type Request } from "@playwright/test";
import { chargeResult, fixture, fixtures, invoiceState, newContext, newInvoice, openCharge, submitCharge } from "./support/helpers";

test.use({ storageState: "tests/e2e/.auth/owner.json" });

test.describe("prices", () => {
  test("typed lines, the form total, Stripe and the app agree to the cent", async ({ page }) => {
    const fx = fixtures();
    const lines: [string, string, string][] = [
      ["Weekly clean", "3", "4.35"],
      ["Supplies", "7", "0.29"],
      ["Deep clean", "1", "$1,234.56"],
      ["Discount", "1", "-20"],
      ["Window", "2", ".5"],
      ["Fridge", "13", "19.99"],
    ];
    const expected = [1305, 203, 123456, -2000, 100, 25987];
    const total = expected.reduce((a, b) => a + b, 0);
    const r = await newInvoice(page, fx.customers.PLAIN.id, lines);
    expect(r.formTotal).toBe("Total $1,490.51");
    const s = invoiceState(r.id!);
    expect(s.total).toBe(total);
    expect(s.subtotal).toBe(total);
    expect(s.lines.map((l) => l.amount)).toEqual(expected);
    expect(s.lines.map((l) => l.quantity)).toEqual([3, 7, 1, 1, 2, 13]);
    expect(s.app.total).toBe(total);
    await expect(page.locator("main tfoot td", { hasText: "$1,490.51" })).toBeVisible();

    // editing keeps it exact and leaves no stale lines
    await page.goto(`/finances/invoices/${r.id}/edit`);
    await page.locator('input[name="lineQuantity"]').nth(0).fill("4");
    await page.getByRole("button", { name: "Remove line 4" }).click();
    await page.getByRole("button", { name: "Add line" }).click();
    const last = (await page.locator('input[name="lineDescription"]').count()) - 1;
    await page.locator('input[name="lineDescription"]').nth(last).fill("Oven");
    await page.locator('input[name="linePrice"]').nth(last).fill("45.10");
    await expect(page.locator("form p", { hasText: /^Total/ }).first()).toHaveText(/\$1,559\.96/);
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/saved=updated/);
    const edited = invoiceState(r.id!);
    expect(edited.lines.map((l) => l.amount)).toEqual([1740, 203, 123456, 100, 25987, 4510]);
    expect(edited.total).toBe(155996);
  });

  test("bad or oversized input is refused and nothing reaches Stripe", async ({ page }) => {
    const fx = fixtures();
    const before = fixture<unknown[]>("stripe-invoices", String(fx.customers.OTHER.id)).length;
    const bad: [string, string, string][] = [
      ["a", "1", "175.555"],
      ["b", "1", "abc"],
      ["c", "1", "1e3"],
      ["d", "1", "12.3.4"],
      ["e", "1", "--5"],
      ["f", "1.5", "10"],
      ["g", "1e2", "10"],
      ["h", "0", "10"],
      ["i", "1000", "10"],
      ["j", "1", "100001"],
      ["k", "999", "200"],
    ];
    const r = await newInvoice(page, fx.customers.OTHER.id, bad);
    expect(r.id).toBeNull();
    expect(await page.locator("form p.text-destructive").count()).toBe(bad.length);
    const big = await newInvoice(page, fx.customers.OTHER.id, [["Big", "1", "60000"], ["Big2", "1", "50000"]]);
    expect(big.errors.join(" ")).toContain("too large");
    expect(fixture<unknown[]>("stripe-invoices", String(fx.customers.OTHER.id)).length).toBe(before);
  });

  test("double-clicking Create makes one invoice", async ({ page }) => {
    const fx = fixtures();
    const before = fixture<unknown[]>("stripe-invoices", String(fx.customers.OTHER.id)).length;
    await page.goto(`/finances/invoices/new?customer=${fx.customers.OTHER.id}`);
    await page.locator('input[name="lineDescription"]').fill("Clean");
    await page.locator('input[name="linePrice"]').fill("80");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Create draft invoice")!;
      b.click();
      b.click();
      b.closest("form")!.requestSubmit();
    });
    await page.waitForURL(/saved=created/);
    await page.waitForTimeout(2500);
    expect(fixture<unknown[]>("stripe-invoices", String(fx.customers.OTHER.id)).length).toBe(before + 1);
  });
});

test.describe("charging", () => {
  test("two tabs charging at the same moment: one charge", async ({ page, browser }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.PLAIN.id, [["Clean", "1", "111"]]);
    const other = await (await newContext(browser, "owner")).newPage();
    await openCharge(page, r.id!);
    await openCharge(other, r.id!);
    await Promise.all([submitCharge(page), submitCharge(other)]);
    const results = await Promise.all([chargeResult(page), chargeResult(other)]);
    expect(results.filter((x) => x.startsWith("ok")).length).toBe(1);
    expect(results.some((x) => x.includes("Nothing was charged"))).toBe(true);
    const s = invoiceState(r.id!);
    expect(s.status).toBe("paid");
    expect(s.succeeded.filter((a) => a === 11100).length).toBe(1);
    await other.goto(`/finances/invoices/${r.id}`);
    await expect(other.getByRole("button", { name: "Charge", exact: true })).toHaveCount(0);
    await other.context().close();
  });

  test("card in one tab, cash in another: only one wins", async ({ page, browser }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.PLAIN.id, [["Clean", "1", "122"]]);
    const other = await (await newContext(browser, "owner")).newPage();
    await openCharge(page, r.id!);
    await openCharge(other, r.id!);
    await other.locator('input[aria-label="Paid another way"]').check();
    await other.getByRole("button", { name: "Cash", exact: true }).click();
    await Promise.all([submitCharge(page), submitCharge(other)]);
    const results = await Promise.all([chargeResult(page), chargeResult(other)]);
    expect(results.filter((x) => x.startsWith("ok")).length).toBe(1);
    const s = invoiceState(r.id!);
    const charged = s.succeeded.filter((a) => a === 12200).length;
    expect(s.status).toBe("paid");
    expect(charged === 1).not.toBe(Boolean(s.metadata.paid_via_note));
    await other.context().close();
  });

  test("a draft edited after the dialog opened is refused, then charged at the new amount", async ({ page, browser }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.PLAIN.id, [["Clean", "1", "100"]]);
    await openCharge(page, r.id!);
    const editor = await (await newContext(browser, "owner")).newPage();
    await editor.goto(`/finances/invoices/${r.id}/edit`);
    await editor.locator('input[name="linePrice"]').first().fill("150");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await editor.waitForURL(/saved=updated/);
    await editor.context().close();
    await submitCharge(page);
    const refused = await chargeResult(page);
    expect(refused).toContain("Nothing was charged");
    expect(refused).toContain("$150.00");
    expect(invoiceState(r.id!).status).toBe("draft");
    await expect(page.getByRole("alertdialog").getByRole("heading")).toHaveText("Charge $150.00");
    await submitCharge(page);
    expect(await chargeResult(page)).toBe("ok:charged");
    expect(invoiceState(r.id!).amountPaid).toBe(15000);
  });

  test("a line added in Stripe after the dialog opened is refused", async ({ page }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.PLAIN.id, [["Clean", "1", "100"]]);
    await openCharge(page, r.id!);
    fixture("addline", String(r.id), "5000");
    await submitCharge(page);
    expect(await chargeResult(page)).toContain("Nothing was charged");
    const s = invoiceState(r.id!);
    expect(s.status).toBe("draft");
    expect(s.amountPaid).toBe(0);
  });

  test("a Stripe credit applied at finalizing is caught before charging", async ({ page }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.CREDIT.id, [["Clean", "1", "100"]]);
    await openCharge(page, r.id!);
    await submitCharge(page);
    const refused = await chargeResult(page);
    expect(refused).toContain("Nothing was charged");
    expect(refused).toContain("$80.00");
    expect(invoiceState(r.id!).succeeded).toEqual([]);
    await expect(page.getByRole("alertdialog").getByRole("heading")).toHaveText("Charge $80.00");
    await submitCharge(page);
    expect(await chargeResult(page)).toBe("ok:charged");
    expect(invoiceState(r.id!).succeeded).toEqual([8000]);
  });

  test("after a decline, another card in the same dialog is charged once", async ({ page }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.DECLINE.id, [["Clean", "1", "100"]]);
    await openCharge(page, r.id!);
    await submitCharge(page);
    expect(await chargeResult(page)).toContain("declined");
    await page.locator(`input[value="${fx.customers.DECLINE.pms[1]}"]`).check();
    await submitCharge(page);
    expect(await chargeResult(page)).toBe("ok:charged");
    const s = invoiceState(r.id!);
    expect(s.succeeded).toEqual([10000]);
    expect(s.failed.length).toBe(1);
  });

  test("marking paid records who did it, in the app and in Stripe", async ({ page }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.OTHER.id, [["Clean", "1", "95"]]);
    await openCharge(page, r.id!);
    await page.locator('input[aria-label="Paid another way"]').check();
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await page.locator("#reference").fill("#1042");
    await submitCharge(page);
    expect(await chargeResult(page)).toBe("ok:paid");
    const s = invoiceState(r.id!);
    expect(s.app.paidVia).toBe("check");
    expect(s.app.note).toBe("Check #1042");
    expect(s.app.paidByUserId).toBe(fx.owner.id);
    expect(s.metadata.collected_by_user_id).toBe(String(fx.owner.id));
    expect(s.metadata.collected_by).toContain("E2E Owner");
    await expect(page.locator("main")).toContainText("recorded by E2E Owner");
  });

  test("a voided invoice can't be collected", async ({ page }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.PLAIN.id, [["Clean", "1", "144"]]);
    await page.getByRole("button", { name: "Finalize", exact: true }).click();
    await page.getByRole("button", { name: "Finalize invoice" }).click();
    await page.waitForURL(/saved=finalized/);
    await openCharge(page);
    fixture("void", String(r.id));
    await submitCharge(page);
    const result = await chargeResult(page);
    expect(result).toMatch(/^refused:.*voided/);
    expect(invoiceState(r.id!).amountPaid).toBe(0);
  });
});

// Captures the charge request the dialog sends, without letting it through.
async function captureChargeRequest(page: Page) {
  let captured: Request | null = null;
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"] && !captured) {
      captured = req;
      await route.abort();
    } else await route.continue();
  });
  await submitCharge(page);
  await expect.poll(() => captured !== null).toBe(true);
  await page.unroute("**/*");
  const req = captured as unknown as Request;
  return { headers: req.headers(), body: req.postData() ?? "" };
}

test.describe("tampered and replayed requests", () => {
  test("the server refuses what the dialog wouldn't allow", async ({ page, playwright }) => {
    const fx = fixtures();
    const r = await newInvoice(page, fx.customers.PLAIN.id, [["Clean", "1", "133"]]);
    await openCharge(page, r.id!);
    const req = await captureChargeRequest(page);
    expect(req.body).toContain("expectedCents");
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const url = new URL(`/finances/invoices/${r.id}`, page.url()).toString();
    // no cookies of its own: each request below decides whether to send one
    const api = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    const send = async (body: string, { withCookie = true, origin = new URL(page.url()).origin } = {}) => {
      const headers: Record<string, string> = { ...req.headers, origin };
      delete headers["content-length"];
      if (withCookie) headers.cookie = cookie;
      else delete headers.cookie;
      const res = await api.post(url, { headers, data: Buffer.from(body), maxRedirects: 0 });
      return { status: res.status(), text: await res.text() };
    };
    const field = (body: string, name: string, value: string) => body.replace(new RegExp(`(name="[^"]*${name}"\\r\\n\\r\\n)[^\\r]*`), `$1${value}`);

    const noSession = await send(req.body, { withCookie: false });
    expect(noSession.status).toBeGreaterThanOrEqual(300);
    expect((await send(req.body, { origin: "https://evil.example" })).status).toBeGreaterThanOrEqual(400);
    expect((await send(field(req.body, "paymentMethodId", fx.customers.OTHER.pms[0]))).text).toContain("doesn't belong");
    expect((await send(field(req.body, "expectedCents", "100"))).text).toContain("Nothing was charged");
    expect(invoiceState(r.id!).amountPaid).toBe(0);
    // the real request, then the same request again: one charge
    await send(req.body);
    await send(req.body);
    const s = invoiceState(r.id!);
    expect(s.amountPaid).toBe(13300);
    expect(s.succeeded.filter((a) => a === 13300).length).toBe(1);
    await api.dispose();
  });
});

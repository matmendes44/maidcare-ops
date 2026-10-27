import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";

export const AUTH_DIR = "tests/e2e/.auth";

// Runs a fixture command (tests/e2e/support/fixtures.mts) and returns its JSON.
export function fixture<T = unknown>(...args: string[]): T {
  const output = execFileSync(
    "npx",
    ["tsx", "--conditions", "react-server", "--env-file=.env.local", "tests/e2e/support/fixtures.mts", ...args],
    { encoding: "utf8" },
  );
  return JSON.parse(output.trim().split("\n").pop()!) as T;
}

type User = { id: number; email: string; password: string; secret: string | null };
type Customer = { id: number; stripe: string; pms: string[] };
export type Fixtures = { owner: User; staff: User; customers: Record<"PLAIN" | "DECLINE" | "CREDIT" | "OTHER", Customer> };
export const fixtures = (): Fixtures => JSON.parse(readFileSync(`${AUTH_DIR}/fixtures.json`, "utf8"));

// The code an authenticator app would show (RFC 6238).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function totp(secret: string, offset = 0) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret.replace(/\s/g, "")) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// Waits out the end of a 30-second step so a code can't expire mid-use.
export async function freshStep() {
  const left = 30 - ((Date.now() / 1000) % 30);
  if (left < 7) await new Promise((r) => setTimeout(r, left * 1000 + 300));
}

export async function enterPassword(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([page.waitForURL((u) => u.pathname !== "/login" || u.search.includes("error"), { timeout: 30_000 }).catch(() => {}), page.locator("#password").press("Enter")]);
}

// Submits a two-step code and waits for the answer.
export async function submitCode(page: Page, code: string) {
  await page.locator("#code").fill(code);
  // the form holding the code box (Next keeps earlier pages' forms in the DOM, hidden)
  const submit = page.locator("form", { has: page.locator("#code") }).locator('button[type="submit"]');
  await submit.click();
  await expect(page.getByRole("button", { name: "Checking…" })).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

export async function signIn(page: Page, user: { email: string; password: string; secret: string | null }, offset = 0) {
  await enterPassword(page, user.email, user.password);
  await expect(page).toHaveURL(/\/login\/verify/);
  await freshStep();
  await submitCode(page, totp(user.secret!, offset));
  await expect(page).toHaveURL((u) => u.pathname === "/");
}

export async function newContext(browser: Browser, role: "owner" | "staff") {
  return browser.newContext({ storageState: `${AUTH_DIR}/${role}.json` });
}

// ---- invoices ----

export async function fillLines(page: Page, lines: [string, string, string][]) {
  for (const [i, [description, quantity, price]] of lines.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add line" }).click();
    await page.locator('input[name="lineDescription"]').nth(i).fill(description);
    await page.locator('input[name="lineQuantity"]').nth(i).fill(quantity);
    await page.locator('input[name="linePrice"]').nth(i).fill(price);
  }
}

// Creates a draft through the form. Returns the form's total and the new
// invoice id, or the errors shown.
export async function newInvoice(page: Page, customerId: number, lines: [string, string, string][]) {
  await page.goto(`/finances/invoices/new?customer=${customerId}`);
  await fillLines(page, lines);
  const formTotal = (await page.locator("form p", { hasText: /^Total/ }).first().innerText()).replace(/\s+/g, " ");
  await page.getByRole("button", { name: "Create draft invoice" }).click();
  await page.waitForFunction(
    () => location.search.includes("saved=created") || document.querySelector('form [role="alert"], form p.text-destructive'),
    undefined,
    { timeout: 60_000 },
  );
  if (!page.url().includes("saved=created")) {
    return { formTotal, id: null, errors: await page.locator('form [role="alert"], form p.text-destructive').allInnerTexts() };
  }
  return { formTotal, id: Number(new URL(page.url()).pathname.split("/").pop()), errors: [] as string[] };
}

export async function openCharge(page: Page, invoiceId?: number) {
  if (invoiceId) await page.goto(`/finances/invoices/${invoiceId}`);
  await page.getByRole("button", { name: "Charge", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
}

export const submitCharge = (page: Page) => page.getByRole("button", { name: /^(Charge \$|Mark \$)/ }).click();

// What happened after submitting the charge dialog.
export async function chargeResult(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Working…"), undefined, { timeout: 8_000 }).catch(() => {});
  await page.waitForFunction(
    () =>
      /saved=(charged|paid|already-)/.test(location.search) ||
      (!![...document.querySelectorAll('[role="alertdialog"] [role="alert"]')].length &&
        ![...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Working…")),
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForLoadState("networkidle");
  const url = page.url();
  if (/saved=(charged|paid)/.test(url)) return `ok:${new URL(url).searchParams.get("saved")}`;
  if (url.includes("saved=already-")) return `refused:${await page.getByRole("status").first().innerText()}`;
  return `error:${await page.locator('[role="alertdialog"] [role="alert"]').innerText()}`;
}

export type InvoiceState = {
  status: string;
  subtotal: number;
  total: number;
  amountPaid: number;
  amountRemaining: number;
  lines: { description: string; quantity: number; amount: number }[];
  succeeded: number[];
  failed: number[];
  metadata: Record<string, string>;
  app: { status: string; total: number; paidVia: string | null; note: string | null; paidByUserId: number | null };
};
export const invoiceState = (id: number) => fixture<InvoiceState>("invoice", String(id));

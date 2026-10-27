import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { AUTH_DIR, fixture, signIn, type Fixtures } from "./support/helpers";

// Creates the test data and signs in the owner and staff test accounts once
// (two-step login included), saving their sessions for the tests to reuse.
export default async function globalSetup() {
  mkdirSync(AUTH_DIR, { recursive: true });
  const fx = fixture<Fixtures>("create");
  writeFileSync(`${AUTH_DIR}/fixtures.json`, JSON.stringify(fx, null, 2));
  const browser = await chromium.launch({ channel: "chrome" });
  for (const [role, user, offset] of [
    ["owner", fx.owner, 0],
    ["staff", fx.staff, 0],
  ] as const) {
    const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });
    const page = await context.newPage();
    await signIn(page, user, offset);
    await context.storageState({ path: `${AUTH_DIR}/${role}.json` });
    await context.close();
  }
  await browser.close();
}

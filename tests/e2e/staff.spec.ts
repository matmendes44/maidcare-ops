// What staff see and can do (lib/auth/permissions.ts): hidden pages and
// buttons, past visits read-only, invoices view-only, one-time expenses
// they can edit (the owner is told), no fleet setup.
import { expect, test, type Page } from "@playwright/test";
import { fixture, fixtures, newContext, newInvoice } from "./support/helpers";

test.use({ storageState: "tests/e2e/.auth/staff.json" });

const fx = fixtures;
const notFound = async (page: Page) => expect(page.locator("body")).toContainText(/could not be found|404/i);

test("the sidebar leaves out what staff can't see, and those pages say so", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Sections" });
  // (a link's name can end in a badge count)
  for (const name of ["Customers", "Appointments", "Invoices", "Estimates", "Expenses", "Fleet", "Reports"]) await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  for (const name of ["Contractors", "Vendors", "Inventory", "Price list", "1099s"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);

  await page.goto("/inventory");
  await expect(page.getByText("You can't see inventory")).toBeVisible();
  await page.goto("/finances/vendors");
  await expect(page.getByText(/You can't see vendors/)).toBeVisible();
  await page.goto("/finances/estimates/pricing");
  await expect(page.getByText(/You can't see/)).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Recurring invoices" })).toHaveCount(0);
});

test("customers: no account fields; properties can't be edited", async ({ page }) => {
  const c = fx().customers.OTHER;
  await page.goto(`/customers/${c.id}/edit`);
  await expect(page.locator("#customerCode")).toHaveAttribute("readonly", "");
  await expect(page.locator('[name="stripeCustomerId"]')).toHaveCount(0);
  await expect(page.locator('select[name="status"]')).toHaveCount(0);

  await page.goto(`/customers/${c.id}`);
  await expect(page.getByRole("link", { name: /New invoice/ })).toHaveCount(0);
  await expect(page.locator('a[href^="/properties/"][href$="/edit"]')).toHaveCount(0);
});

test("appointments: past ones are read-only; future ones can be changed but not completed", async ({ page }) => {
  const c = fx().customers.OTHER;
  const past = fixture<{ id: number }>("appointment", String(c.id), "-3");
  const future = fixture<{ id: number }>("appointment", String(c.id), "3");

  await page.goto(`/appointments/${past.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  for (const name of ["Mark completed", "Cancel appointment", "Reopen", "Delete"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.goto(`/appointments/${past.id}/edit`);
  await notFound(page);

  await page.goto(`/appointments/${future.id}`);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toBeVisible();
  for (const name of ["Mark completed", "Delete"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Make invoice/ })).toHaveCount(0);
  await page.goto(`/appointments/${future.id}/edit`);
  await expect(page.locator('select[name="status"]')).toHaveCount(0);
});

test("invoices are view-only", async ({ browser, page }) => {
  const owner = await (await newContext(browser, "owner")).newPage();
  const r = await newInvoice(owner, fx().customers.OTHER.id, [["Clean", "1", "55"]]);
  await owner.context().close();

  await page.goto("/finances");
  await expect(page.getByRole("link", { name: "New invoice" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Sync/ })).toHaveCount(0);
  await page.goto(`/finances/invoices/${r.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const name of ["Edit", "Open in Stripe"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  for (const name of [/^Charge/, /recurring/i, /^Finalize/, /Delete draft/]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  await page.goto(`/finances/invoices/${r.id}/edit`);
  await notFound(page);
  await page.goto("/finances/invoices/new");
  await notFound(page);
});

test("fleet: no Setup tab and no Locate properties", async ({ page }) => {
  await page.goto("/fleet?tab=setup");
  const tabs = page.getByRole("navigation", { name: "Fleet sections" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Setup" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Locate/ })).toHaveCount(0);
});

test("expenses: one-time only; staff edit their own and the owner is told", async ({ page }) => {
  const f = fx();
  await page.goto("/finances/expenses");
  await expect(page.getByRole("heading", { name: "Expenses", level: 1 })).toBeVisible();
  await expect(page.getByText("Export", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Expense views" }).getByRole("link", { name: "Recurring" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Recurring", exact: true })).toHaveCount(0);
  expect((await page.request.get("/api/expenses/export?format=csv")).status()).toBe(200);

  // the form has no Repeats; saving makes a one-time expense
  await page.goto("/finances/expenses/new");
  await expect(page.locator("#repeats")).toHaveCount(0);
  await page.goto("/finances/expenses/recurring/new");
  await expect(page.getByText(/You can't see/)).toBeVisible();

  // their own: editable, and the edit is reported to the owner
  const mine = fixture<{ id: number }>("expense", "E2E Staff Store", f.staff.email, "1200");
  await page.goto(`/finances/expenses/${mine.id}`);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.locator("#amount").fill("15.50");
  await page.locator("#description").fill("Gloves");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  const sent = fixture<{ title: string; body: string; href: string; audience: string }[]>("notifications", "expense_edited").filter((n) => n.href === `/finances/expenses/${mine.id}`);
  expect(sent).toHaveLength(1);
  expect(sent[0].audience).toBe("owner");
  expect(sent[0].title).toBe("{name} edited an expense: {vendor}, {date}");
  expect(sent[0].body).toContain("Amount: $12.00 → $15.50");
  expect(sent[0].body).toContain('Description: (none) → "Gloves"');

  // the owner sees it in the bell; staff don't
  expect(((await (await page.request.get("/api/notifications")).json()) as { items: { href: string }[] }).items.some((n) => n.href === `/finances/expenses/${mine.id}`)).toBe(false);

  // someone else's: view only
  const theirs = fixture<{ id: number }>("expense", "E2E Staff Store", f.owner.email, "3000");
  await page.goto(`/finances/expenses/${theirs.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("$30.00");
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await page.goto(`/finances/expenses/${theirs.id}/edit`);
  await expect(page.getByText(/You can't see this expense/)).toBeVisible();
});

test("staff who pick Portuguese see the app in Portuguese", async ({ page }) => {
  const f = fx();
  fixture("locale", f.staff.email, "pt-BR");
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/^(Bom dia|Boa tarde|Boa noite)/);
    await expect(page.getByRole("heading", { name: "Precisa de atenção" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Seções" });
    for (const name of ["Clientes", "Agendamentos", "Faturas", "Orçamentos", "Despesas", "Frota", "Relatórios"]) await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    await page.goto("/finances/estimates");
    await expect(page.getByRole("heading", { name: "Orçamentos", level: 1 })).toBeVisible();
    await page.goto("/finances/expenses");
    await expect(page.getByRole("heading", { name: "Despesas", level: 1 })).toBeVisible();
    await expect(page.getByText("Exportar", { exact: true })).toBeVisible();
    await page.goto("/reports?tab=money");
    await expect(page.getByRole("heading", { name: "Receita por mês" })).toBeVisible();
    await page.goto("/appointments/new");
    await expect(page.getByText("Quem vai limpar", { exact: true })).toBeVisible();
  } finally {
    fixture("locale", f.staff.email, "en-US");
  }
});

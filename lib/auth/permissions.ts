// Who may do what. THE place to change what admins and staff can do: every
// sensitive action and button checks a permission from this list.
//
// The owner can always do everything. Staff do the day-to-day work the owner
// has decided on (see their list below); admin keeps the everyday work it has
// always had until its duties are decided. Add a permission to a role's list
// to allow it.
import { isDemo } from "@/lib/demo";

export const roles = ["owner", "admin", "staff"] as const;
export type Role = (typeof roles)[number];

export const permissions = {
  "invoices.collect": "Charge cards and mark invoices paid",
  "invoices.finalize": "Finalize invoices (gives them their number; they can't be edited after)",
  "invoices.deleteDraft": "Delete draft invoices",
  "invoices.memorize": "Set a customer's recurring (memorized) invoice, change how often it repeats, pause or stop it",
  "customers.delete": "Delete customers (and their Stripe customer)",
  "stripe.manage": "Sync with Stripe, link Stripe customers, create or update customers in Stripe",
  "fleet.manage": "Connect or disconnect Bouncie and link trackers to vehicles",
  "users.manage": "Add people, change roles, reset two-step login, disable accounts",
  "reports.view": "See the Reports page (revenue, outstanding balances, customer and pricing numbers)",
  "expenses.view": "See expenses, receipts and what the business spends, and export them",
  "expenses.manage": "Add, edit and delete any expense, recurring expenses and vendors",
  "contractors.view": "See contractors, their pay rates, days worked and what they're owed",
  "contractors.manage": "Add and edit contractors, change pay rates, assign past visits",
  "quotes.manage": "Create, edit and send estimates, and book accepted ones",
  "inventory.manage": "Add and edit inventory items and equipment, receive stock, restock vehicles, count, move and write off stock, resolve reports",
  "contractors.tax": "See and change tax ID numbers, W-9s and 1099s, and export 1099 data",
  "customers.create": "Add customers (anyone can add leads)",
  "customers.editAccount": "Change a customer's code and status",
  "properties.edit": "Edit properties",
  "appointments.editPast": "Edit or cancel appointments on days that have passed",
  "appointments.complete": "Mark appointments completed, reopen them, or set their status when editing",
  "appointments.delete": "Delete appointments",
  "invoices.create": "Make and edit invoices by hand, and sync invoices with Stripe",
  "quotes.duplicate": "Duplicate estimates",
  "priceList.manage": "See and change the estimate price list",
  "expenses.create": "Add one-time expenses and edit the ones they added (the owner is told about every edit)",
  "vendors.view": "See vendors",
  "inventory.view": "See inventory: stock, equipment, usage and locations",
  "fleet.service": "Record vehicle services and change service intervals",
} as const;
export type Permission = keyof typeof permissions;

// the everyday work every role could do before roles were decided
const everyday: Permission[] = ["fleet.service", "customers.create", "customers.editAccount", "properties.edit", "appointments.editPast", "appointments.complete", "appointments.delete", "invoices.create", "inventory.view"];

const granted: Record<Role, readonly Permission[] | "all"> = {
  owner: "all",
  admin: everyday,
  // staff: customers, leads, properties (adding), booking (today on), estimates,
  // one-time expenses, reports; invoices and the rest are view-only or hidden
  staff: ["quotes.manage", "expenses.view", "expenses.create", "reports.view"],
};

export const roleLabels: Record<Role, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

// Off for everyone in the public demo, owner included: these would let one
// visitor lock the others out, or try to reach a real Stripe or Bouncie account.
export const demoBlocked: readonly Permission[] = ["users.manage", "fleet.manage", "stripe.manage"];

// The rule itself, with nothing read from the environment.
export function allowed(role: Role, permission: Permission, demo: boolean) {
  if (demo && demoBlocked.includes(permission)) return false;
  const list = granted[role];
  return list === "all" || list.includes(permission);
}

// What the app calls: the rule for the signed-in user, in this deployment.
export function can(user: { role: Role } | null | undefined, permission: Permission) {
  return !!user && allowed(user.role, permission, isDemo());
}

// Shared by server and client code, so only *types* come from the schema —
// labels for each value are in lib/i18n/messages.
import type { customers } from "@/db/schema";

type Customer = typeof customers.$inferSelect;
export type CustomerType = Customer["type"];
export type CustomerStatus = Customer["status"];
export type EndReason = Customer["endReasons"][number];

// Values in display order. Their labels live in the message dictionaries
// (lib/i18n/messages), which fail to compile if a value is missing.
export const customerTypes: CustomerType[] = ["residential", "commercial", "referral_partner"];
export const customerStatuses: CustomerStatus[] = ["lead", "active", "paused", "inactive"];
export const endReasons: EndReason[] = ["quality", "scheduling_communication", "client_circumstances"];

export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// Editable customer columns, in form order (labels: t.customers.fields).
export const customerFields = [
  "customerCode",
  "type",
  "status",
  "startDate",
  "endDate",
  "endReasons",
  "firstName",
  "lastName",
  "companyName",
  "email",
  "referredById",
  "billingPropertyId",
  "stripeCustomerId",
  "notes",
] as const;

export type CustomerField = (typeof customerFields)[number];

// Field names of the first property on the new-customer form.
export const FIRST_PROPERTY_PREFIX = "property_";
export type CustomerFormValues = Record<CustomerField, string>;

// Turns submitted form data into trimmed strings. The server validates these,
// and the edit form uses the same function to work out what changed.
export function normalizeCustomerForm(formData: FormData): CustomerFormValues {
  const get = (field: CustomerField) => {
    const value = formData.get(field);
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    customerCode: get("customerCode").toUpperCase(),
    type: get("type"),
    status: get("status"),
    startDate: get("startDate"),
    endDate: get("endDate"),
    // checkbox group; kept in canonical order so edits compare reliably
    endReasons: endReasons
      .filter((r) => formData.getAll("endReasons").includes(r))
      .join(","),
    firstName: get("firstName"),
    lastName: get("lastName"),
    companyName: get("companyName"),
    email: get("email").toLowerCase(),
    referredById: get("referredById"),
    billingPropertyId: get("billingPropertyId"),
    stripeCustomerId: get("stripeCustomerId"),
    notes: get("notes"),
  };
}

// The inverse: a DB row as the strings the form works with.
export function customerToFormValues(c: Customer): CustomerFormValues {
  return {
    customerCode: c.customerCode,
    type: c.type,
    status: c.status,
    startDate: c.startDate,
    endDate: c.endDate ?? "",
    endReasons: endReasons.filter((r) => c.endReasons.includes(r)).join(","),
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    companyName: c.companyName ?? "",
    email: c.email ?? "",
    referredById: c.referredById?.toString() ?? "",
    billingPropertyId: c.billingPropertyId?.toString() ?? "",
    stripeCustomerId: c.stripeCustomerId ?? "",
    notes: c.notes ?? "",
  };
}

export function displayName(c: {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}) {
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return person || c.companyName || "—";
}

// US phone numbers are stored as +1XXXXXXXXXX. Returns null if the input
// isn't a 10-digit US number (an optional leading 1 is allowed).
export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// "+14105551234" → "(410) 555-1234"; anything else is shown as stored.
export function formatPhone(phone: string) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

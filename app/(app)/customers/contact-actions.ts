"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { pgError } from "@/lib/db-helpers";
import { getI18n } from "@/lib/i18n/server";
import { normalizePhone } from "./options";
import { logError } from "@/lib/log";
import { syncStripeCustomer } from "@/lib/stripe-customers";

export type ContactField = "name" | "role" | "phone" | "email";

export type ContactFormState = {
  errors?: Partial<Record<ContactField, string>>;
  message?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addContact(
  customerId: number,
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  await requireUser();
  const { t } = await getI18n();
  const e = t.contacts.errors;
  const text = (name: ContactField) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const name = text("name");
  const role = text("role");
  const rawPhone = text("phone");
  const email = text("email").toLowerCase();
  const isPrimary = formData.get("isPrimary") !== null;
  const smsOptIn = formData.get("smsOptIn") !== null;

  const errors: NonNullable<ContactFormState["errors"]> = {};
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) errors.phone = e.phone;
  if (email && !EMAIL_RE.test(email)) errors.email = e.email;
  if (!name && !rawPhone && !email) errors.name = e.required;
  if (Object.keys(errors).length > 0) return { errors };

  const insert = db.insert(contacts).values({
    customerId,
    name: name || null,
    role: role || null,
    phone,
    email: email || null,
    isPrimary,
    smsOptIn,
  });

  try {
    // Only one primary contact per customer (one_primary_contact index), so a
    // new primary demotes the current one in the same transaction.
    if (isPrimary) {
      await db.batch([
        db
          .update(contacts)
          .set({ isPrimary: false })
          .where(and(eq(contacts.customerId, customerId), eq(contacts.isPrimary, true))),
        insert,
      ]);
    } else {
      await insert;
    }
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23503") return { message: e.customerGone };
    logError("contact save failed", err);
    return { message: e.saveFailed };
  }

  // their phone in Stripe comes from the contacts (skipped if not in Stripe yet)
  if (phone) await syncStripeCustomer(customerId);
  redirect(`/customers/${customerId}?saved=contact`);
}

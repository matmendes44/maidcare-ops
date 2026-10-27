"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { expenses, recurringExpenses, vendors } from "@/db/schema";
import { checkPermission } from "@/lib/auth/session";
import { asUser, nextId, pgError } from "@/lib/db-helpers";
import { categoryKeys, type Category } from "@/lib/expenses/options";
import { logError } from "@/lib/log";
import { nextVendorCode } from "./code";
import { cleanWebsite, normalizeVendorForm, type VendorField } from "./options";

export type VendorFormState = { errors?: Partial<Record<VendorField, string>>; message?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function parse(formData: FormData) {
  const v = normalizeVendorForm(formData);
  const errors: NonNullable<VendorFormState["errors"]> = {};
  if (!v.name) errors.name = "Enter the vendor's name.";
  else if (v.name.length > 120) errors.name = "Keep the name under 120 characters.";
  if (v.defaultCategory && !categoryKeys.includes(v.defaultCategory as Category)) errors.defaultCategory = "Pick a category from the list.";
  if (v.email && !EMAIL_RE.test(v.email)) errors.email = "That email address doesn't look right.";
  const website = cleanWebsite(v.website);
  if (website === false) errors.website = "Enter a web address like samsclub.com.";
  for (const k of ["contactName", "phone", "address", "accountNumber"] as const)
    if (v[k].length > 200) errors[k] = "That's too long.";
  if (v.notes.length > 5000) errors.notes = "Keep notes under 5,000 characters.";
  // the vendor ID isn't taken from the form: it's assigned on create and
  // never changes
  const data = {
    name: v.name,
    defaultCategory: (v.defaultCategory || null) as Category | null,
    contactName: v.contactName || null,
    email: v.email || null,
    phone: v.phone || null,
    website: website || null,
    address: v.address || null,
    accountNumber: v.accountNumber || null,
    notes: v.notes || null,
    isActive: v.isActive !== "false",
  };
  return { data, errors, hasErrors: Object.keys(errors).length > 0 };
}

function dbError(err: unknown): VendorFormState {
  const pg = pgError(err);
  if (pg?.code === "23505" && pg.constraint === "vendors_name_key") return { errors: { name: "There's already a vendor with this name." } };
  logError("vendor save failed", err);
  return { message: "Couldn't save the vendor. Please try again." };
}

export async function createVendor(_prev: VendorFormState, formData: FormData): Promise<VendorFormState> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  const { data, errors, hasErrors } = await parse(formData);
  if (hasErrors) return { errors };
  let id = 0;
  // the next V number; if someone takes it at the same moment, try the next
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    try {
      const vendorCode = await nextVendorCode();
      const newId = await nextId("vendors");
      await db.batch([asUser(access.user.id), db.insert(vendors).values({ ...data, id: newId, vendorCode })]);
      id = newId;
    } catch (err) {
      const pg = pgError(err);
      if (pg?.code === "23505" && pg.constraint === "vendors_vendor_code_key") continue;
      return dbError(err);
    }
  }
  if (!id) return { message: "Couldn't save the vendor. Please try again." };
  redirect(`/finances/vendors/${id}?saved=created`);
}

export async function updateVendor(id: number, _prev: VendorFormState, formData: FormData): Promise<VendorFormState> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  const { data, errors, hasErrors } = await parse(formData);
  if (hasErrors) return { errors };
  try {
    const [, updated] = await db.batch([
      asUser(access.user.id),
      db.update(vendors).set(data).where(eq(vendors.id, id)).returning({ id: vendors.id }),
    ]);
    if (updated.length === 0) return { message: "This vendor no longer exists." };
  } catch (err) {
    return dbError(err);
  }
  redirect(`/finances/vendors/${id}?saved=updated`);
}

// Only vendors with no expenses or recurring expenses can be deleted; the
// rest are marked inactive so their history stays.
export async function deleteVendor(id: number): Promise<{ message?: string }> {
  const access = await checkPermission("expenses.manage");
  if (!access.user) return { message: access.denied };
  const [[{ n }], [{ r }]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.vendorId, id)),
    db.select({ r: sql<number>`count(*)::int` }).from(recurringExpenses).where(eq(recurringExpenses.vendorId, id)),
  ]);
  if (n > 0 || r > 0)
    return { message: `This vendor has ${n > 0 ? `${n} ${n === 1 ? "expense" : "expenses"}` : `${r} recurring ${r === 1 ? "expense" : "expenses"}`}, so it can't be deleted. Mark it inactive instead.` };
  try {
    await db.batch([asUser(access.user.id), db.delete(vendors).where(eq(vendors.id, id))]);
  } catch (err) {
    logError("vendor delete failed", err);
    return { message: "Couldn't delete the vendor. Please try again." };
  }
  redirect("/finances/vendors?deleted=1");
}

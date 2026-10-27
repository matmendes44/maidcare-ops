// Shared by server and client code, so only *types* come from the schema.
import type { properties } from "@/db/schema";
import type { Messages } from "@/lib/i18n/messages";

type Property = typeof properties.$inferSelect;
export type ServiceZone = NonNullable<Property["zone"]>;

// Labels: t.enums.zone (lib/i18n/messages).
export const zones: ServiceZone[] = ["south", "northwest", "city_core", "north_northeast", "other"];

export function formatAddress(p: {
  street: string;
  unit: string | null;
  city: string;
  state: string;
  zip: string;
}) {
  return `${p.street}${p.unit ? `, ${p.unit}` : ""}, ${p.city}, ${p.state} ${p.zip}`;
}

// Address fields, shared by the property form and the first property on the
// new-customer form (where they're prefixed so they don't clash).
// Labels: t.properties.address.
export const addressFields = ["street", "unit", "city", "state", "zip", "zone"] as const;
export type AddressField = (typeof addressFields)[number];
export type AddressValues = Record<AddressField, string>;
export type AddressErrors = Partial<Record<AddressField, string>>;

export function readAddress(formData: FormData, prefix = ""): AddressValues {
  const get = (field: AddressField) => {
    const value = formData.get(prefix + field);
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    street: get("street"),
    unit: get("unit"),
    city: get("city"),
    state: get("state").toUpperCase(),
    zip: get("zip"),
    zone: get("zone"),
  };
}

export function isAddressBlank(v: AddressValues) {
  return !v.street && !v.unit && !v.city && !v.zip;
}

// Mirrors the properties table: street, city and a 5-digit ZIP are required.
export function validateAddress(v: AddressValues, t: Messages): AddressErrors {
  const e = t.properties.errors;
  const errors: AddressErrors = {};
  if (!v.street) errors.street = e.street;
  if (!v.city) errors.city = e.city;
  if (!/^[A-Z]{2}$/.test(v.state)) errors.state = e.state;
  if (!/^\d{5}$/.test(v.zip)) errors.zip = e.zip;
  if (v.zone && !zones.includes(v.zone as ServiceZone)) errors.zone = e.zone;
  return errors;
}

export function addressToRow(v: AddressValues) {
  return {
    street: v.street,
    unit: v.unit || null,
    city: v.city,
    state: v.state,
    zip: v.zip,
    zone: (v.zone || null) as ServiceZone | null,
  };
}

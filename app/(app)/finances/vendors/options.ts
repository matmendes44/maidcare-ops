// Vendor form values, shared by the form and the server.
export const vendorFields = [
  "vendorCode",
  "name",
  "defaultCategory",
  "contactName",
  "email",
  "phone",
  "website",
  "address",
  "accountNumber",
  "notes",
  "isActive",
] as const;
export type VendorField = (typeof vendorFields)[number];
export type VendorFormValues = Record<VendorField, string>;

export const vendorLabels: Record<VendorField, string> = {
  vendorCode: "Vendor ID",
  name: "Name",
  defaultCategory: "Usual category",
  contactName: "Contact person",
  email: "Email",
  phone: "Phone",
  website: "Website",
  address: "Address",
  accountNumber: "Our account number",
  notes: "Notes",
  isActive: "Status",
};

export function normalizeVendorForm(formData: FormData): VendorFormValues {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  return {
    // never read from the form: assigned by the server (vendors/code.ts)
    vendorCode: "",
    name: get("name").replace(/\s+/g, " "),
    defaultCategory: get("defaultCategory"),
    contactName: get("contactName"),
    email: get("email").toLowerCase(),
    phone: get("phone"),
    website: get("website"),
    address: get("address"),
    accountNumber: get("accountNumber"),
    notes: get("notes"),
    isActive: get("isActive") === "false" ? "false" : "true",
  };
}

// Websites are shown as links, so only http(s) addresses are kept ("acme.com"
// becomes "https://acme.com"); javascript: and other schemes are refused
// (false). Null when blank.
export function cleanWebsite(raw: string): string | null | false {
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (!url.hostname.includes(".")) return false;
    return url.toString();
  } catch {
    return false;
  }
}

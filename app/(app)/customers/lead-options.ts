import type { AddressErrors } from "../properties/options";

// The kinds of customer a new lead can be.
export const LEAD_TYPES = ["residential", "commercial"] as const;

export type LeadField = "firstName" | "lastName" | "companyName" | "email" | "phone" | "type" | "notes";
export type LeadFormState = { errors?: Partial<Record<LeadField, string>>; propertyErrors?: AddressErrors; message?: string };

// Contractor form values, shared by the form and the server.
export const contractorFields = [
  "firstName",
  "lastName",
  "businessName",
  "email",
  "phone",
  "street",
  "city",
  "state",
  "zip",
  "taxClassification",
  "w9ReceivedOn",
  "startDate",
  "isActive",
  "notes",
  "tinType",
  "tin",
  "dayRate",
] as const;
export type ContractorField = (typeof contractorFields)[number];
export type ContractorFormValues = Record<ContractorField, string>;

export const contractorName = (c: { firstName: string; lastName: string; businessName?: string | null }) => `${c.firstName} ${c.lastName}`;
// the name their vendor record (and expenses) show
export const vendorNameFor = (c: { firstName: string; lastName: string; businessName?: string | null }) =>
  c.businessName ? `${c.businessName} (${c.firstName} ${c.lastName})` : `${c.firstName} ${c.lastName}`;

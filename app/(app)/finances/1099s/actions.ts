"use server";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { contractorTaxIds } from "@/db/schema";
import { auditEntry } from "@/lib/audit";
import { decrypt } from "@/lib/auth/crypto";
import { checkPermission } from "@/lib/auth/session";
import { confirmFreshCode } from "@/lib/auth/step-up";
import { formatTin, isCorporation, taxClassifications, thresholdCents, type TaxClassification } from "@/lib/contractors/tax";
import { csv } from "@/lib/xlsx";
import { taxYearSummary } from "../../contractors/data";

export type ExportState = { message?: string; file?: { name: string; body: string } };

// The year's 1099-NEC data as CSV: payer-ready rows for everyone who needs a
// 1099 (or everyone, with `all`), in the order IRS IRIS and most filing
// services ask for. Full tax IDs only after a fresh authenticator code; the
// export is logged per contractor.
export async function export1099s(year: number, _prev: ExportState, formData: FormData): Promise<ExportState> {
  const access = await checkPermission("contractors.tax");
  if (!access.user) return { message: access.denied };
  const withTin = formData.get("withTin") === "1";
  if (withTin) {
    const problem = await confirmFreshCode(access.user, String(formData.get("code") ?? ""));
    if (problem) return { message: problem };
  }
  const everyone = formData.get("all") === "1";
  const rows = (await taxYearSummary(year)).filter((r) => everyone || (r.reportableCents >= thresholdCents(year) && !isCorporation(r.taxClassification)));
  const tins = new Map<number, string>();
  if (withTin && rows.length) {
    for (const t of await db.select().from(contractorTaxIds).where(inArray(contractorTaxIds.contractorId, rows.map((r) => r.id))))
      tins.set(t.contractorId, decrypt(t.tinEncrypted, "contractor-tin"));
    await db.batch(rows.map((r) => auditEntry(access.user.id, "contractor_tax_ids", r.id, "view", { tin: "exported", tax_year: year })) as [never, ...never[]]);
  }
  const header = ["Tax year", "Vendor ID", "Last name", "First name", "Business name", "Tax ID type", "Tax ID", "Street", "City", "State", "ZIP", "Email", "Box 1 nonemployee compensation", "Card/app payments (not on 1099-NEC)", "Tax classification", "W-9 received"];
  const body = csv([
    header,
    ...rows.map((r) => [
      year,
      r.vendorCode,
      r.lastName,
      r.firstName,
      r.businessName ?? "",
      r.tinType?.toUpperCase() ?? "",
      withTin ? (tins.has(r.id) ? formatTin(r.tinType, tins.get(r.id)!) : "MISSING") : r.tinLast4 ? `***${r.tinLast4}` : "MISSING",
      r.street ?? "",
      r.city ?? "",
      r.state ?? "",
      r.zip ?? "",
      r.email ?? "",
      (r.reportableCents / 100).toFixed(2),
      (r.excludedCents / 100).toFixed(2),
      r.taxClassification ? taxClassifications[r.taxClassification as TaxClassification] : "",
      r.w9ReceivedOn ?? "",
    ]),
  ]);
  return { file: { name: `1099-nec-${year}${withTin ? "" : "-masked"}.csv`, body } };
}

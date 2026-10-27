import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryAssets, inventoryItems } from "@/db/schema";
import { reportKindKeys, type AssetStatus, type ReportKind } from "@/lib/inventory/options";
import { toReceipt } from "@/lib/receipts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const id = (s: string) => (/^\d{1,15}$/.test(s) ? Number(s) : null);

// Shared by the in-app form and the QR form (app/r): checks the choices and
// builds the row. A broken or missing report marks the equipment.
export async function buildReport(f: FormData, scope: { locationId: number | null; assetId?: number | null }) {
  const kind = text(f, "kind") as ReportKind;
  if (!reportKindKeys.includes(kind)) return { error: "Pick what's wrong." };
  const itemId = id(text(f, "itemId"));
  const assetId = scope.assetId ?? id(text(f, "assetId"));
  const note = text(f, "note").slice(0, 1000) || null;
  if ((kind === "low" || kind === "out") && !itemId) return { error: "Pick what's running low." };
  if ((kind === "broken" || kind === "missing") && !assetId && !itemId) return { error: "Pick what's broken or missing." };
  if (kind === "other" && !note) return { error: "Say what's wrong." };
  let photo: Buffer | null = null;
  const file = f.get("photo");
  if (file instanceof File && file.size > 0) {
    if (file.size > 4_000_000) return { error: "That photo is over 4 MB." };
    const r = await toReceipt(Buffer.from(await file.arrayBuffer()), file.name);
    if (!r || r.contentType !== "image/webp") return { error: "The photo has to be a picture (JPEG, PNG, HEIC…)." };
    photo = r.data;
  }
  if (assetId) {
    const [a] = await db.select({ id: inventoryAssets.id, locationId: inventoryAssets.locationId }).from(inventoryAssets).where(eq(inventoryAssets.id, assetId));
    if (!a) return { error: "That equipment no longer exists." };
    if (scope.locationId && !scope.assetId && a.locationId !== scope.locationId) return { error: "That equipment isn't kept here." };
  }
  if (itemId) {
    const [i] = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
    if (!i) return { error: "That item no longer exists." };
  }
  const contractorId = id(text(f, "contractorId"));
  return {
    row: { kind, itemId, assetId: assetId ?? null, locationId: scope.locationId, note, photo, contractorId, reporterName: text(f, "reporterName").slice(0, 60) || null },
    marks: assetId && (kind === "broken" || kind === "missing") ? { assetId, status: (kind === "broken" ? "needs_repair" : "lost") as AssetStatus } : null,
  };
}


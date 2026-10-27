"use server";

import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { inventoryAssets, inventoryLocations, inventoryReports } from "@/db/schema";
import { buildReport } from "../(app)/inventory/report-build";

type Msg = { message?: string; ok?: string };

// How often one device, and one QR code, may report: enough for a real
// problem, not enough to flood the inbox.
const PER_DEVICE_PER_HOUR = 10;
const PER_CODE_PER_HOUR = 40;

async function deviceHash() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}:${ip}`).digest("hex");
}

async function tooMany(ipHash: string, scope: ReturnType<typeof eq>) {
  const hourAgo = sql`now() - interval '1 hour'`;
  const [[{ device }], [{ code }]] = await Promise.all([
    db.select({ device: sql<number>`count(*)::int` }).from(inventoryReports).where(and(eq(inventoryReports.ipHash, ipHash), gt(inventoryReports.createdAt, hourAgo))),
    db.select({ code: sql<number>`count(*)::int` }).from(inventoryReports).where(and(scope, gt(inventoryReports.createdAt, hourAgo))),
  ]);
  return device >= PER_DEVICE_PER_HOUR || code >= PER_CODE_PER_HOUR;
}

// A report from the QR code in a vehicle or storage. The token is the only
// key: it can only add reports for that place, nothing else.
export async function reportFromLocation(token: string, _prev: Msg, f: FormData): Promise<Msg> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { message: "This code isn't valid anymore." };
  const [loc] = await db.select({ id: inventoryLocations.id, isActive: inventoryLocations.isActive }).from(inventoryLocations).where(eq(inventoryLocations.reportToken, token));
  if (!loc?.isActive) return { message: "This code isn't valid anymore. Ask for a new label." };
  const ipHash = await deviceHash();
  if (await tooMany(ipHash, eq(inventoryReports.locationId, loc.id))) return { message: "Too many reports for now. Try again in an hour, or tell the office." };
  const built = await buildReport(f, { locationId: loc.id });
  if ("error" in built) return { message: built.error };
  await db.batch([
    db.insert(inventoryReports).values({ ...built.row!, source: "qr", ipHash }),
    ...(built.marks ? [db.update(inventoryAssets).set({ status: built.marks.status }).where(and(eq(inventoryAssets.id, built.marks.assetId), eq(inventoryAssets.status, "in_service")))] : []),
  ]);
  return { ok: "Thanks! The office has been told." };
}

// A report from the QR label on a piece of equipment.
export async function reportFromAsset(token: string, _prev: Msg, f: FormData): Promise<Msg> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { message: "This code isn't valid anymore." };
  const [asset] = await db.select({ id: inventoryAssets.id, locationId: inventoryAssets.locationId, status: inventoryAssets.status }).from(inventoryAssets).where(eq(inventoryAssets.reportToken, token));
  if (!asset || asset.status === "retired") return { message: "This code isn't valid anymore. Ask for a new label." };
  const ipHash = await deviceHash();
  if (await tooMany(ipHash, eq(inventoryReports.assetId, asset.id))) return { message: "Too many reports for now. Try again in an hour, or tell the office." };
  const built = await buildReport(f, { locationId: asset.locationId, assetId: asset.id });
  if ("error" in built) return { message: built.error };
  await db.batch([
    db.insert(inventoryReports).values({ ...built.row!, source: "qr", ipHash }),
    ...(built.marks ? [db.update(inventoryAssets).set({ status: built.marks.status }).where(and(eq(inventoryAssets.id, built.marks.assetId), eq(inventoryAssets.status, "in_service")))] : []),
  ]);
  return { ok: "Thanks! The office has been told." };
}

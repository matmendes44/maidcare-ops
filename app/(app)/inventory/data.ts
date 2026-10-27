import "server-only";

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  appointments,
  contractors,
  expenses,
  inventoryAssetEvents,
  inventoryAssets,
  inventoryItems,
  inventoryLocations,
  inventoryMovements,
  inventoryPars,
  inventoryReports,
  users,
  vehicles,
  vendors,
} from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { reorder, stockStatus, type StockStatus } from "@/lib/inventory/stock";
import { TIME_ZONE } from "@/lib/i18n/config";

export const newToken = () => randomBytes(32).toString("hex");
export const parseId = (raw: string) => (/^\d{1,15}$/.test(raw) ? Number(raw) : null);
const TZ = sql.raw(`'${TIME_ZONE}'`);

// Every vehicle gets a location (vehicles come from Bouncie and can appear
// at any time).
async function ensureVehicleLocations() {
  const missing = await db
    .select({ id: vehicles.id, name: vehicles.name, isActive: vehicles.isActive })
    .from(vehicles)
    .leftJoin(inventoryLocations, eq(inventoryLocations.vehicleId, vehicles.id))
    .where(isNull(inventoryLocations.id));
  if (missing.length)
    await db
      .insert(inventoryLocations)
      .values(missing.map((v) => ({ kind: "vehicle" as const, name: v.name, vehicleId: v.id, isActive: v.isActive, reportToken: newToken() })))
      .onConflictDoNothing();
}

export async function getLocations() {
  await requireUser();
  await ensureVehicleLocations();
  return db
    .select({ location: inventoryLocations, vehicleName: vehicles.name })
    .from(inventoryLocations)
    .leftJoin(vehicles, eq(vehicles.id, inventoryLocations.vehicleId))
    .orderBy(desc(inventoryLocations.isActive), sql`case ${inventoryLocations.kind} when 'storage' then 0 when 'vehicle' then 1 else 2 end`, asc(inventoryLocations.name))
    .then((rows) => rows.map((r) => ({ ...r.location, name: r.location.kind === "vehicle" && r.vehicleName ? r.vehicleName : r.location.name })));
}
export type Location = Awaited<ReturnType<typeof getLocations>>[number];

export async function getLocation(id: number) {
  return (await getLocations()).find((l) => l.id === id) ?? null;
}

// How much of each item is at each location, from the movement ledger.
export async function stockLevels(itemIds?: number[]) {
  const filter = itemIds?.length ? sql`where item_id in ${itemIds}` : sql``;
  const rows = (
    await db.execute(sql`
      select item_id, location_id, sum(q)::int as qty from (
        select item_id, to_location_id as location_id, quantity as q from inventory_movements where to_location_id is not null
        union all
        select item_id, from_location_id, -quantity from inventory_movements where from_location_id is not null
      ) m ${filter} group by 1, 2`)
  ).rows as { item_id: string | number; location_id: string | number; qty: number }[];
  const map = new Map<number, Map<number, number>>();
  for (const r of rows) {
    const item = Number(r.item_id);
    if (!map.has(item)) map.set(item, new Map());
    map.get(item)!.set(Number(r.location_id), Number(r.qty));
  }
  return map;
}

// How much was used (and written off) per item since a day.
export async function usageSince(fromDay: string) {
  const rows = await db
    .select({
      itemId: inventoryMovements.itemId,
      used: sql<number>`coalesce(sum(${inventoryMovements.quantity}) filter (where ${inventoryMovements.kind} = 'use'), 0)::int`,
      writtenOff: sql<number>`coalesce(sum(${inventoryMovements.quantity}) filter (where ${inventoryMovements.kind} = 'write_off'), 0)::int`,
      costCents: sql<number>`coalesce(sum(${inventoryMovements.quantity} * coalesce(${inventoryMovements.unitCostCents}, 0)) filter (where ${inventoryMovements.kind} in ('use', 'write_off')), 0)::float8`,
    })
    .from(inventoryMovements)
    .where(gte(inventoryMovements.createdAt, sql`(${fromDay}::date::timestamp at time zone ${TZ})`))
    .groupBy(inventoryMovements.itemId);
  return new Map(rows.map((r) => [r.itemId, r]));
}

// The par (how many should be there) for each item at a location: a set par,
// else for vehicles the item's vehicle_par.
export async function parsFor(location: { id: number; kind: string }) {
  const [items, overrides] = await Promise.all([
    db.select({ id: inventoryItems.id, vehiclePar: inventoryItems.vehiclePar }).from(inventoryItems).where(eq(inventoryItems.isActive, true)),
    db.select().from(inventoryPars).where(eq(inventoryPars.locationId, location.id)),
  ]);
  const map = new Map<number, number>();
  for (const i of items) if (location.kind === "vehicle" && i.vehiclePar > 0) map.set(i.id, i.vehiclePar);
  for (const o of overrides) map.set(o.itemId, o.par);
  return map;
}

export async function getItems({ includeInactive = false } = {}) {
  await requireUser();
  return db
    .select({ item: inventoryItems, vendorName: vendors.name })
    .from(inventoryItems)
    .leftJoin(vendors, eq(vendors.id, inventoryItems.preferredVendorId))
    .where(includeInactive ? undefined : eq(inventoryItems.isActive, true))
    .orderBy(asc(inventoryItems.category), asc(sql`lower(${inventoryItems.name})`));
}

export type StockRow = {
  id: number;
  name: string;
  kind: "supply" | "reusable";
  category: string;
  unit: string;
  reorderPoint: number;
  reorderQuantity: number;
  vehiclePar: number;
  unitCostCents: number | null;
  vendorName: string | null;
  preferredVendorId: number | null;
  byLocation: Map<number, number>;
  total: number;
  storage: number;
  status: StockStatus;
  perDay: number;
  used30: number;
  suggestion: ReturnType<typeof reorder>;
};

// Supplies and reusables with their stock everywhere, status, recent use and
// whether to reorder.
export async function stockOverview(today: string, locations: Location[]) {
  const from30 = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const [items, levels, usage] = await Promise.all([getItems(), stockLevels(), usageSince(from30)]);
  const storageIds = new Set(locations.filter((l) => l.kind === "storage" && l.isActive).map((l) => l.id));
  return items
    .filter((r) => r.item.kind !== "equipment")
    .map(({ item, vendorName }): StockRow => {
      const byLocation = levels.get(item.id) ?? new Map<number, number>();
      const total = [...byLocation.values()].reduce((a, b) => a + b, 0);
      const storage = [...byLocation.entries()].filter(([loc]) => storageIds.has(loc)).reduce((a, [, q]) => a + q, 0);
      const u = usage.get(item.id);
      const used30 = (u?.used ?? 0) + (u?.writtenOff ?? 0);
      const perDay = used30 / 30;
      return {
        id: item.id,
        name: item.name,
        kind: item.kind as "supply" | "reusable",
        category: item.category,
        unit: item.unit,
        reorderPoint: item.reorderPoint,
        reorderQuantity: item.reorderQuantity,
        vehiclePar: item.vehiclePar,
        unitCostCents: item.unitCostCents,
        vendorName,
        preferredVendorId: item.preferredVendorId,
        byLocation,
        total,
        storage,
        status: stockStatus(storage, item.reorderPoint),
        perDay,
        used30,
        suggestion: reorder({ totalOnHand: total, storageOnHand: storage, reorderPoint: item.reorderPoint, reorderQuantity: item.reorderQuantity, perDay }),
      };
    });
}

export async function getItem(id: number) {
  await requireUser();
  const [row] = await db
    .select({ item: inventoryItems, vendorName: vendors.name })
    .from(inventoryItems)
    .leftJoin(vendors, eq(vendors.id, inventoryItems.preferredVendorId))
    .where(eq(inventoryItems.id, id));
  return row ?? null;
}

export async function movementsFor(where: { itemId?: number; locationId?: number }, limit = 100) {
  const fromLoc = alias(inventoryLocations, "from_loc");
  const toLoc = alias(inventoryLocations, "to_loc");
  const fromVeh = alias(vehicles, "from_veh");
  const toVeh = alias(vehicles, "to_veh");
  return db
    .select({
      movement: inventoryMovements,
      itemName: inventoryItems.name,
      unit: inventoryItems.unit,
      fromName: sql<string | null>`coalesce(${fromVeh.name}, ${fromLoc.name})`,
      toName: sql<string | null>`coalesce(${toVeh.name}, ${toLoc.name})`,
      byName: users.name,
    })
    .from(inventoryMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
    .leftJoin(fromLoc, eq(fromLoc.id, inventoryMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, inventoryMovements.toLocationId))
    .leftJoin(fromVeh, eq(fromVeh.id, fromLoc.vehicleId))
    .leftJoin(toVeh, eq(toVeh.id, toLoc.vehicleId))
    .leftJoin(users, eq(users.id, inventoryMovements.createdBy))
    .where(
      and(
        where.itemId ? eq(inventoryMovements.itemId, where.itemId) : undefined,
        where.locationId ? sql`(${inventoryMovements.fromLocationId} = ${where.locationId} or ${inventoryMovements.toLocationId} = ${where.locationId})` : undefined,
      ),
    )
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(limit);
}

// Use per week for one item (or all), for charts.
export async function weeklyUse(fromDay: string, itemId?: number) {
  const rows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${inventoryMovements.createdAt} at time zone ${TZ}), 'YYYY-MM-DD')`,
      used: sql<number>`coalesce(sum(${inventoryMovements.quantity}) filter (where ${inventoryMovements.kind} = 'use'), 0)::int`,
      writtenOff: sql<number>`coalesce(sum(${inventoryMovements.quantity}) filter (where ${inventoryMovements.kind} = 'write_off'), 0)::int`,
      costCents: sql<number>`coalesce(sum(${inventoryMovements.quantity} * coalesce(${inventoryMovements.unitCostCents}, 0)) filter (where ${inventoryMovements.kind} in ('use', 'write_off')), 0)::float8`,
    })
    .from(inventoryMovements)
    .where(and(gte(inventoryMovements.createdAt, sql`(${fromDay}::date::timestamp at time zone ${TZ})`), itemId ? eq(inventoryMovements.itemId, itemId) : undefined))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows;
}

// Use by location (which vehicle goes through what) since a day.
export async function usageByLocation(fromDay: string) {
  return db
    .select({
      locationId: inventoryMovements.fromLocationId,
      costCents: sql<number>`coalesce(sum(${inventoryMovements.quantity} * coalesce(${inventoryMovements.unitCostCents}, 0)), 0)::float8`,
      units: sql<number>`sum(${inventoryMovements.quantity})::int`,
    })
    .from(inventoryMovements)
    .where(and(inArray(inventoryMovements.kind, ["use", "write_off"]), gte(inventoryMovements.createdAt, sql`(${fromDay}::date::timestamp at time zone ${TZ})`)))
    .groupBy(inventoryMovements.fromLocationId);
}

export async function completedVisits(fromDay: string, toDay: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(eq(appointments.status, "completed"), sql`(${appointments.scheduledStart} at time zone ${TZ})::date between ${fromDay}::date and ${toDay}::date`));
  return row.n;
}

// ---- equipment ----
export async function getAssets() {
  await requireUser();
  const locVeh = alias(vehicles, "loc_veh");
  return db
    .select({
      asset: inventoryAssets,
      itemName: inventoryItems.name,
      category: inventoryItems.category,
      serviceIntervalDays: inventoryItems.serviceIntervalDays,
      usefulLifeMonths: inventoryItems.usefulLifeMonths,
      locationName: sql<string>`coalesce(${locVeh.name}, ${inventoryLocations.name})`,
      locationKind: inventoryLocations.kind,
      openReports: sql<number>`(select count(*)::int from inventory_reports r where r.asset_id = "inventory_assets"."id" and r.status = 'open')`,
    })
    .from(inventoryAssets)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryAssets.itemId))
    .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryAssets.locationId))
    .leftJoin(locVeh, eq(locVeh.id, inventoryLocations.vehicleId))
    .orderBy(asc(inventoryItems.name), asc(inventoryAssets.assetTag));
}
export type AssetRow = Awaited<ReturnType<typeof getAssets>>[number];

export async function getAsset(id: number) {
  const rows = await getAssets();
  const row = rows.find((r) => r.asset.id === id);
  if (!row) return null;
  const fromLoc = alias(inventoryLocations, "from_loc");
  const toLoc = alias(inventoryLocations, "to_loc");
  const fromVeh = alias(vehicles, "from_veh");
  const toVeh = alias(vehicles, "to_veh");
  const [events, [purchase]] = await Promise.all([
    db
      .select({
        event: inventoryAssetEvents,
        fromName: sql<string | null>`coalesce(${fromVeh.name}, ${fromLoc.name})`,
        toName: sql<string | null>`coalesce(${toVeh.name}, ${toLoc.name})`,
        byName: users.name,
      })
      .from(inventoryAssetEvents)
      .leftJoin(fromLoc, eq(fromLoc.id, inventoryAssetEvents.fromLocationId))
      .leftJoin(toLoc, eq(toLoc.id, inventoryAssetEvents.toLocationId))
      .leftJoin(fromVeh, eq(fromVeh.id, fromLoc.vehicleId))
      .leftJoin(toVeh, eq(toVeh.id, toLoc.vehicleId))
      .leftJoin(users, eq(users.id, inventoryAssetEvents.createdBy))
      .where(eq(inventoryAssetEvents.assetId, id))
      .orderBy(desc(inventoryAssetEvents.createdAt), desc(inventoryAssetEvents.id)),
    db
      .select({ id: expenses.id, expenseDate: expenses.expenseDate, amountCents: expenses.amountCents, vendorId: vendors.id, vendorName: vendors.name })
      .from(expenses)
      .innerJoin(vendors, eq(vendors.id, expenses.vendorId))
      .where(eq(expenses.id, row.asset.expenseId)),
  ]);
  return { ...row, events, purchase: purchase ?? null };
}

// Expenses an asset or a delivery could be tied to: the last 6 months.
export async function recentExpenses() {
  await requireUser();
  return db
    .select({ id: expenses.id, expenseDate: expenses.expenseDate, amountCents: expenses.amountCents, vendorName: vendors.name, description: expenses.description })
    .from(expenses)
    .innerJoin(vendors, eq(vendors.id, expenses.vendorId))
    .where(sql`${expenses.expenseDate} >= current_date - 183`)
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .limit(150);
}

// ---- reports from cleaners ----
export async function getReports({ open = true, limit = 100 } = {}) {
  await requireUser();
  const locVeh = alias(vehicles, "loc_veh");
  const reporter = alias(users, "reporter");
  return db
    .select({
      report: {
        id: inventoryReports.id,
        kind: inventoryReports.kind,
        itemId: inventoryReports.itemId,
        assetId: inventoryReports.assetId,
        locationId: inventoryReports.locationId,
        note: inventoryReports.note,
        reporterName: inventoryReports.reporterName,
        source: inventoryReports.source,
        status: inventoryReports.status,
        resolution: inventoryReports.resolution,
        resolvedAt: inventoryReports.resolvedAt,
        createdAt: inventoryReports.createdAt,
        hasPhoto: sql<boolean>`${inventoryReports.photo} is not null`,
      },
      itemName: inventoryItems.name,
      assetTag: inventoryAssets.assetTag,
      locationName: sql<string | null>`coalesce(${locVeh.name}, ${inventoryLocations.name})`,
      reporterUser: reporter.name,
      contractorName: sql<string | null>`case when ${contractors.id} is null then null else ${contractors.firstName} || ' ' || left(${contractors.lastName}, 1) || '.' end`,
    })
    .from(inventoryReports)
    .leftJoin(inventoryItems, eq(inventoryItems.id, inventoryReports.itemId))
    .leftJoin(inventoryAssets, eq(inventoryAssets.id, inventoryReports.assetId))
    .leftJoin(inventoryLocations, eq(inventoryLocations.id, inventoryReports.locationId))
    .leftJoin(locVeh, eq(locVeh.id, inventoryLocations.vehicleId))
    .leftJoin(reporter, eq(reporter.id, inventoryReports.reportedByUserId))
    .leftJoin(contractors, eq(contractors.id, inventoryReports.contractorId))
    .where(open ? eq(inventoryReports.status, "open") : undefined)
    .orderBy(desc(inventoryReports.createdAt))
    .limit(limit);
}
export type ReportRow = Awaited<ReturnType<typeof getReports>>[number];

export async function openReportCount() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryReports).where(eq(inventoryReports.status, "open"));
  return row.n;
}

// Items and equipment at a location, for the report forms (QR and in-app).
export async function reportChoices(locationId: number | null) {
  const items = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name, kind: inventoryItems.kind })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.isActive, true), sql`${inventoryItems.kind} <> 'equipment'`))
    .orderBy(asc(inventoryItems.name));
  const assets = await db
    .select({ id: inventoryAssets.id, tag: inventoryAssets.assetTag, name: inventoryItems.name })
    .from(inventoryAssets)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryAssets.itemId))
    .where(and(sql`${inventoryAssets.status} not in ('retired', 'lost')`, locationId ? eq(inventoryAssets.locationId, locationId) : undefined))
    .orderBy(asc(inventoryItems.name));
  const people = await db
    .select({ id: contractors.id, name: sql<string>`${contractors.firstName} || ' ' || left(${contractors.lastName}, 1) || '.'` })
    .from(contractors)
    .where(eq(contractors.isActive, true))
    .orderBy(asc(contractors.firstName));
  // items in this location's kit first
  if (locationId) {
    const loc = await db.select({ id: inventoryLocations.id, kind: inventoryLocations.kind }).from(inventoryLocations).where(eq(inventoryLocations.id, locationId));
    if (loc[0]) {
      const pars = await parsFor(loc[0]);
      items.sort((a, b) => Number(pars.has(b.id)) - Number(pars.has(a.id)) || a.name.localeCompare(b.name));
    }
  }
  return { items, assets, people };
}

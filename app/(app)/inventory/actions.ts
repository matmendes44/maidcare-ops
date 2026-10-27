"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { expenses, inventoryAssetEvents, inventoryAssets, inventoryItems, inventoryLocations, inventoryMovements, inventoryPars, inventoryReports, vendors } from "@/db/schema";
import { checkPermission, requireUser } from "@/lib/auth/session";
import { asUser, nextId, pgError } from "@/lib/db-helpers";
import { cardBrandKeys, isCard, paymentMethodKeys, type CardBrand, type PaymentMethod } from "@/lib/expenses/options";
import { assetStatusKeys, itemCategoryKeys, itemKindKeys, units, type AssetStatus, type ItemCategory, type ItemKind, type Unit } from "@/lib/inventory/options";
import { countResult } from "@/lib/inventory/stock";
import { logError } from "@/lib/log";
import { todayISO } from "../customers/options";
import { parseCents } from "../finances/invoices/money";
import { nextVendorCode } from "../finances/vendors/code";
import { getLocation, newToken, parsFor, stockLevels } from "./data";
import { buildReport } from "./report-build";

type Msg = { message?: string; ok?: string; errors?: Record<string, string> };
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const id = (s: string) => (/^\d{1,15}$/.test(s) ? Number(s) : null);
const whole = (s: string, max = 100_000) => (/^\d{1,6}$/.test(s) && Number(s) <= max ? Number(s) : null);

// ---- items ----
function parseItem(f: FormData) {
  const errors: Record<string, string> = {};
  const name = text(f, "name").replace(/\s+/g, " ");
  if (!name) errors.name = "Enter the item's name.";
  else if (name.length > 120) errors.name = "Keep the name under 120 characters.";
  const kind = text(f, "kind") as ItemKind;
  if (!itemKindKeys.includes(kind)) errors.kind = "Pick how it's tracked.";
  const category = text(f, "category") as ItemCategory;
  if (!itemCategoryKeys.includes(category)) errors.category = "Pick a category.";
  const unit = (text(f, "unit") || "each") as Unit;
  if (!units.includes(unit)) errors.unit = "Pick a unit.";
  const num = (k: string, label: string) => {
    const raw = text(f, k);
    if (!raw) return 0;
    const n = whole(raw, 10_000);
    if (n === null) errors[k] = `${label} must be a whole number.`;
    return n ?? 0;
  };
  const cost = text(f, "unitCost");
  const unitCostCents = cost ? parseCents(cost) : null;
  if (cost && (unitCostCents === null || unitCostCents < 0)) errors.unitCost = "Enter a cost like 3.49.";
  const optionalWhole = (k: string, label: string) => {
    const raw = text(f, k);
    if (!raw) return null;
    const n = whole(raw, 10_000);
    if (!n) errors[k] = `${label} must be a whole number.`;
    return n;
  };
  const data = {
    name,
    kind,
    category,
    unit,
    sku: text(f, "sku").slice(0, 60) || null,
    vehiclePar: kind === "equipment" ? 0 : num("vehiclePar", "Per vehicle"),
    reorderPoint: kind === "equipment" ? 0 : num("reorderPoint", "Reorder point"),
    reorderQuantity: kind === "equipment" ? 0 : num("reorderQuantity", "Reorder quantity"),
    unitCostCents,
    preferredVendorId: id(text(f, "preferredVendorId")),
    serviceIntervalDays: kind === "equipment" ? optionalWhole("serviceIntervalDays", "Service interval") : null,
    usefulLifeMonths: kind === "equipment" ? optionalWhole("usefulLifeMonths", "Useful life") : null,
    notes: text(f, "notes").slice(0, 2000) || null,
    isActive: text(f, "isActive") !== "false",
  };
  return { data, errors };
}

const itemDbError = (err: unknown): Msg => {
  const pg = pgError(err);
  if (pg?.code === "23505" && pg.constraint === "inventory_items_name_key") return { errors: { name: "There's already an item with this name." } };
  logError("inventory item save failed", err);
  return { message: "Couldn't save the item. Please try again." };
};

export async function createItem(_prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const { data, errors } = parseItem(f);
  // starting stock, counted into storage
  const startQty = text(f, "startQuantity") ? whole(text(f, "startQuantity")) : 0;
  if (startQty === null) errors.startQuantity = "Starting stock must be a whole number.";
  const storageId = id(text(f, "storageId"));
  if (Object.keys(errors).length) return { errors };
  let newId: number;
  try {
    newId = await nextId("inventory_items");
    await db.batch([
      asUser(access.user.id),
      db.insert(inventoryItems).values({ ...data, id: newId }),
      ...(startQty && storageId && data.kind !== "equipment"
        ? [db.insert(inventoryMovements).values({ itemId: newId, kind: "adjust", quantity: startQty, toLocationId: storageId, unitCostCents: data.unitCostCents, note: "Starting count" })]
        : []),
    ]);
  } catch (err) {
    return itemDbError(err);
  }
  redirect(`/inventory/items/${newId}?saved=created`);
}

export async function updateItem(itemId: number, _prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const { data, errors } = parseItem(f);
  if (Object.keys(errors).length) return { errors };
  const [current] = await db.select({ kind: inventoryItems.kind }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!current) return { message: "This item no longer exists." };
  // how it's tracked can't flip between equipment and stock once in use
  if ((current.kind === "equipment") !== (data.kind === "equipment")) return { errors: { kind: "Equipment can't be switched to counted stock (or back). Add a new item instead." } };
  try {
    await db.batch([asUser(access.user.id), db.update(inventoryItems).set(data).where(eq(inventoryItems.id, itemId))]);
  } catch (err) {
    return itemDbError(err);
  }
  redirect(`/inventory/items/${itemId}?saved=updated`);
}

// ---- payments: a new expense, or one already recorded ----
// Shared by receiving stock and adding equipment: both need to say what they
// were bought with.
async function purchaseFrom(f: FormData, totalCents: number | null, description: string, category: "supplies" | "equipment") {
  const errors: Record<string, string> = {};
  if (text(f, "purchase") === "existing") {
    const expenseId = id(text(f, "expenseId"));
    if (!expenseId) return { errors: { expenseId: "Pick the expense it was bought with." } };
    const [e] = await db.select({ id: expenses.id, amountCents: expenses.amountCents, expenseDate: expenses.expenseDate }).from(expenses).where(eq(expenses.id, expenseId));
    if (!e) return { errors: { expenseId: "That expense no longer exists." } };
    return { expenseId: e.id, inserts: [], amountCents: e.amountCents, expenseDate: e.expenseDate, errors };
  }
  const date = text(f, "purchaseDate");
  if (!isDay(date)) errors.purchaseDate = "Enter the purchase date.";
  else if (date > todayISO()) errors.purchaseDate = "The purchase date can't be in the future.";
  const amount = totalCents ?? parseCents(text(f, "cost"));
  if (amount === null || amount <= 0) errors.cost = "Enter what it cost.";
  else if (amount > 100_000_000) errors.cost = "That's more than $1,000,000.";
  const method = text(f, "paymentMethod") as PaymentMethod;
  if (!paymentMethodKeys.includes(method)) errors.paymentMethod = "Pick how it was paid.";
  const brand = isCard(method) && text(f, "cardBrand") ? (text(f, "cardBrand") as CardBrand) : null;
  if (brand && !cardBrandKeys.includes(brand)) errors.cardBrand = "Pick a card.";
  const last4 = isCard(method) ? text(f, "cardLast4").replace(/\D/g, "") || null : null;
  if (last4 && last4.length !== 4) errors.cardLast4 = "Enter the card's last 4 digits.";
  // the vendor: an existing one or a new one typed in
  const rawVendor = text(f, "vendorId");
  let vendorId = id(rawVendor);
  const inserts = [];
  if (rawVendor === "new") {
    const name = text(f, "newVendorName").replace(/\s+/g, " ");
    if (!name) errors.newVendorName = "Enter the store's name.";
    else {
      const [existing] = await db.select({ id: vendors.id }).from(vendors).where(sql`lower(${vendors.name}) = lower(${name})`);
      if (existing) vendorId = existing.id;
      else {
        vendorId = await nextId("vendors");
        inserts.push(db.insert(vendors).values({ id: vendorId, vendorCode: await nextVendorCode(), name, defaultCategory: category }));
      }
    }
  } else if (!vendorId) errors.vendorId = "Pick where it was bought.";
  if (Object.keys(errors).length) return { errors };
  const expenseId = await nextId("expenses");
  inserts.push(
    db.insert(expenses).values({ id: expenseId, expenseDate: date, vendorId: vendorId!, category, amountCents: amount!, paymentMethod: method, cardBrand: brand, cardLast4: last4, reference: text(f, "reference").slice(0, 100) || null, description }),
  );
  return { expenseId, inserts, amountCents: amount!, expenseDate: date, errors };
}

// ---- receiving stock ----
// A delivery or shopping trip: items and how many, into a location, paid
// for with a new or existing expense. Each item's unit cost is updated.
export async function receiveStock(_prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const locationId = id(text(f, "locationId"));
  if (!locationId) return { errors: { locationId: "Pick where it went." } };
  const lines = f
    .getAll("lineItem")
    .map((raw, i) => ({ itemId: id(String(raw)), qty: whole(String(f.getAll("lineQty")[i] ?? "")), cost: parseCents(String(f.getAll("lineCost")[i] ?? "")) }))
    .filter((l) => l.itemId || l.qty);
  if (!lines.length) return { errors: { lines: "Add at least one item." } };
  if (lines.some((l) => !l.itemId || !l.qty)) return { errors: { lines: "Each line needs an item and a whole-number quantity." } };
  if (lines.some((l) => l.cost === null || l.cost < 0)) return { errors: { lines: "Each line needs its total cost, like 24.99 (0 if free)." } };
  const items = await db.select({ id: inventoryItems.id, name: inventoryItems.name, kind: inventoryItems.kind }).from(inventoryItems).where(inArray(inventoryItems.id, lines.map((l) => l.itemId!)));
  if (items.length !== new Set(lines.map((l) => l.itemId)).size) return { errors: { lines: "An item no longer exists." } };
  if (items.some((i) => i.kind === "equipment")) return { errors: { lines: "Equipment is added one by one (Equipment → Add equipment), so it gets an asset tag." } };
  const total = lines.reduce((s, l) => s + l.cost!, 0);
  const names = lines.map((l) => `${l.qty} × ${items.find((i) => i.id === l.itemId)!.name}`).join(", ");
  const purchase = await purchaseFrom(f, total > 0 ? total : null, `Inventory: ${names}`.slice(0, 300), "supplies");
  if (Object.keys(purchase.errors).length) return { errors: purchase.errors };
  try {
    await db.batch([
      asUser(access.user.id),
      ...purchase.inserts!,
      ...lines.map((l) => db.insert(inventoryMovements).values({ itemId: l.itemId!, kind: "purchase", quantity: l.qty!, toLocationId: locationId, unitCostCents: Math.round(l.cost! / l.qty!), expenseId: purchase.expenseId })),
      ...lines.filter((l) => l.cost! > 0).map((l) => db.update(inventoryItems).set({ unitCostCents: Math.round(l.cost! / l.qty!) }).where(eq(inventoryItems.id, l.itemId!))),
    ]);
  } catch (err) {
    logError("receive stock failed", err);
    return { message: "Couldn't save the delivery. Please try again." };
  }
  redirect(`/inventory?tab=supplies&saved=received`);
}

// ---- moving, using, writing off ----
export async function recordMovement(itemId: number, _prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const kind = text(f, "kind");
  const qty = whole(text(f, "quantity"));
  if (!qty) return { message: "Enter a whole-number quantity." };
  const from = id(text(f, "fromLocationId"));
  const to = id(text(f, "toLocationId"));
  const note = text(f, "note").slice(0, 300) || null;
  const [item] = await db.select({ kind: inventoryItems.kind, unitCostCents: inventoryItems.unitCostCents }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item || item.kind === "equipment") return { message: "This item can't be moved this way." };
  let values: typeof inventoryMovements.$inferInsert;
  if (kind === "transfer") {
    if (!from || !to || from === to) return { message: "Pick where it's moving from and to." };
    values = { itemId, kind: "transfer", quantity: qty, fromLocationId: from, toLocationId: to, note };
  } else if (kind === "use" || kind === "write_off") {
    if (!from) return { message: "Pick where it came from." };
    values = { itemId, kind, quantity: qty, fromLocationId: from, unitCostCents: item.unitCostCents, note };
  } else if (kind === "found") {
    if (!to) return { message: "Pick where it was found." };
    values = { itemId, kind: "adjust", quantity: qty, toLocationId: to, unitCostCents: item.unitCostCents, note: note ?? "Found" };
  } else return { message: "Pick what happened." };
  if (values.fromLocationId) {
    const onHand = (await stockLevels([itemId])).get(itemId)?.get(values.fromLocationId) ?? 0;
    if (qty > onHand) return { message: `Only ${onHand} there. Count it first if that's wrong.` };
  }
  await db.batch([asUser(access.user.id), db.insert(inventoryMovements).values(values)]);
  refresh();
  return { ok: "Saved." };
}

// ---- counts and vehicle restocks ----
// For each item: what's actually there. Shortfalls become use (supplies) or
// write-offs (reusables), extras are found. For a vehicle, the load-up from
// storage brings it back to par.
export async function submitCount(locationId: number, _prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const location = await getLocation(locationId);
  if (!location) return { message: "This location no longer exists." };
  const sourceId = id(text(f, "sourceId"));
  const itemIds = f.getAll("itemId").map(String).map(id).filter((x): x is number => x !== null);
  const items = itemIds.length ? await db.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds)) : [];
  const levels = await stockLevels(itemIds);
  const pars = await parsFor(location);
  const inserts: (typeof inventoryMovements.$inferInsert)[] = [];
  const short: string[] = [];
  for (const item of items) {
    if (item.kind === "equipment") continue;
    const countedRaw = text(f, `count-${item.id}`);
    const loadRaw = text(f, `load-${item.id}`);
    const expected = levels.get(item.id)?.get(locationId) ?? 0;
    const counted = countedRaw === "" ? expected : whole(countedRaw);
    if (counted === null) return { message: `Enter a whole number for ${item.name}.` };
    const r = countResult(item.kind as "supply" | "reusable", expected, counted, pars.get(item.id) ?? 0);
    const cost = item.unitCostCents;
    if (r.used) inserts.push({ itemId: item.id, kind: "use", quantity: r.used, fromLocationId: locationId, unitCostCents: cost, note: "Counted" });
    if (r.writtenOff) inserts.push({ itemId: item.id, kind: "write_off", quantity: r.writtenOff, fromLocationId: locationId, unitCostCents: cost, note: "Missing or worn out at count" });
    if (r.found) inserts.push({ itemId: item.id, kind: "adjust", quantity: r.found, toLocationId: locationId, unitCostCents: cost, note: "Found at count" });
    if (location.kind !== "storage" && sourceId && loadRaw !== "") {
      const load = whole(loadRaw);
      if (load === null) return { message: `Enter a whole number to load for ${item.name}.` };
      if (load > 0) {
        const available = levels.get(item.id)?.get(sourceId) ?? 0;
        const moved = Math.min(load, Math.max(0, available));
        if (moved < load) short.push(`${item.name} (${moved} of ${load})`);
        if (moved > 0) inserts.push({ itemId: item.id, kind: "transfer", quantity: moved, fromLocationId: sourceId, toLocationId: locationId, note: "Restock" });
      }
    }
  }
  if (inserts.length) await db.batch([asUser(access.user.id), ...inserts.map((v) => db.insert(inventoryMovements).values(v))]);
  const msg = short.length ? `short=${encodeURIComponent(short.join(", "))}` : "";
  redirect(`/inventory/locations/${locationId}?saved=${location.kind === "vehicle" ? "restocked" : "counted"}${msg ? `&${msg}` : ""}`);
}

// ---- equipment ----
export async function createAsset(_prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const errors: Record<string, string> = {};
  const itemId = id(text(f, "itemId"));
  if (!itemId) errors.itemId = "Pick what kind of equipment it is.";
  const locationId = id(text(f, "locationId"));
  if (!locationId) errors.locationId = "Pick where it's kept.";
  const warranty = text(f, "warrantyUntil");
  if (warranty && !isDay(warranty)) errors.warrantyUntil = "That date doesn't look right.";
  const [item] = itemId ? await db.select({ name: inventoryItems.name, kind: inventoryItems.kind }).from(inventoryItems).where(eq(inventoryItems.id, itemId)) : [];
  if (itemId && item?.kind !== "equipment") errors.itemId = "Pick an equipment item.";
  const serial = text(f, "serialNumber").slice(0, 80) || null;
  if (Object.keys(errors).length) return { errors };
  const assetId = await nextId("inventory_assets");
  const [{ maxTag }] = await db.select({ maxTag: sql<number | null>`max(substring(${inventoryAssets.assetTag} from '^A(\\d+)$')::int)` }).from(inventoryAssets);
  const assetTag = `A${(maxTag ?? 999) + 1}`;
  const purchase = await purchaseFrom(f, null, `Equipment ${assetTag}: ${item!.name}${serial ? ` (serial ${serial})` : ""}`, "equipment");
  if (Object.keys(purchase.errors).length) return { errors: purchase.errors };
  // the asset's cost: what it cost on its own when typed, else the expense's total
  const ownCost = text(f, "assetCost") ? parseCents(text(f, "assetCost")) : null;
  if (text(f, "assetCost") && (ownCost === null || ownCost < 0)) return { errors: { assetCost: "Enter a cost like 399.99." } };
  try {
    await db.batch([
      asUser(access.user.id),
      ...purchase.inserts!,
      db.insert(inventoryAssets).values({
        id: assetId,
        assetTag,
        itemId: itemId!,
        serialNumber: serial,
        locationId: locationId!,
        expenseId: purchase.expenseId!,
        purchaseCostCents: ownCost ?? purchase.amountCents!,
        purchasedOn: purchase.expenseDate!,
        warrantyUntil: warranty || null,
        reportToken: newToken(),
        notes: text(f, "notes").slice(0, 2000) || null,
      }),
      db.insert(inventoryAssetEvents).values({ assetId, kind: "added", toLocationId: locationId, createdBy: access.user.id }),
    ]);
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23505") return { message: "Someone added equipment at the same moment. Please save again." };
    logError("asset create failed", err);
    return { message: "Couldn't save the equipment. Please try again." };
  }
  redirect(`/inventory/assets/${assetId}?saved=created`);
}

export async function updateAsset(assetId: number, _prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const warranty = text(f, "warrantyUntil");
  if (warranty && !isDay(warranty)) return { errors: { warrantyUntil: "That date doesn't look right." } };
  const cost = parseCents(text(f, "assetCost"));
  if (cost === null || cost < 0) return { errors: { assetCost: "Enter a cost like 399.99." } };
  await db.batch([
    asUser(access.user.id),
    db
      .update(inventoryAssets)
      .set({ serialNumber: text(f, "serialNumber").slice(0, 80) || null, warrantyUntil: warranty || null, purchaseCostCents: cost, notes: text(f, "notes").slice(0, 2000) || null })
      .where(eq(inventoryAssets.id, assetId)),
  ]);
  redirect(`/inventory/assets/${assetId}?saved=updated`);
}

// Moving equipment between storage and vehicles, changing its status, or
// logging routine service.
export async function assetAction(assetId: number, _prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const [asset] = await db.select().from(inventoryAssets).where(eq(inventoryAssets.id, assetId));
  if (!asset) return { message: "This equipment no longer exists." };
  const action = text(f, "action");
  const note = text(f, "note").slice(0, 500) || null;
  if (action === "move") {
    const to = id(text(f, "toLocationId"));
    if (!to || to === asset.locationId) return { message: "Pick where it's going." };
    await db.batch([
      asUser(access.user.id),
      db.update(inventoryAssets).set({ locationId: to }).where(eq(inventoryAssets.id, assetId)),
      db.insert(inventoryAssetEvents).values({ assetId, kind: "moved", fromLocationId: asset.locationId, toLocationId: to, note, createdBy: access.user.id }),
    ]);
    refresh();
    return { ok: "Moved." };
  }
  if (action === "status") {
    const status = text(f, "status") as AssetStatus;
    if (!assetStatusKeys.includes(status) || status === asset.status) return { message: "Pick a new status." };
    await db.batch([
      asUser(access.user.id),
      db.update(inventoryAssets).set({ status }).where(eq(inventoryAssets.id, assetId)),
      db.insert(inventoryAssetEvents).values({ assetId, kind: "status", status, note, createdBy: access.user.id }),
      // back in service: open broken/missing reports about it are done
      ...(status === "in_service"
        ? [db.update(inventoryReports).set({ status: "resolved", resolvedAt: sql`now()`, resolvedBy: access.user.id, resolution: "Back in service" }).where(and(eq(inventoryReports.assetId, assetId), eq(inventoryReports.status, "open")))]
        : []),
    ]);
    refresh();
    return { ok: "Status changed." };
  }
  if (action === "service") {
    const day = text(f, "serviceDate") || todayISO();
    if (!isDay(day) || day > todayISO()) return { message: "Enter the service date." };
    const cost = text(f, "serviceCost") ? parseCents(text(f, "serviceCost")) : null;
    if (text(f, "serviceCost") && (cost === null || cost < 0)) return { message: "Enter a cost like 25.00." };
    await db.batch([
      asUser(access.user.id),
      db.update(inventoryAssets).set({ lastServicedOn: day }).where(eq(inventoryAssets.id, assetId)),
      db.insert(inventoryAssetEvents).values({ assetId, kind: "serviced", costCents: cost, note: note ?? "Routine service", createdBy: access.user.id }),
    ]);
    refresh();
    return { ok: "Service logged." };
  }
  if (action === "note") {
    if (!note) return { message: "Write the note." };
    await db.insert(inventoryAssetEvents).values({ assetId, kind: "note", note, createdBy: access.user.id });
    refresh();
    return { ok: "Note added." };
  }
  return { message: "Pick what to do." };
}

// ---- locations ----
export async function createLocation(_prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const kind = text(f, "kind");
  const name = text(f, "name").slice(0, 80);
  if (kind !== "storage" && kind !== "site") return { message: "Pick storage or a client site." };
  if (!name) return { message: "Enter a name." };
  const propertyId = kind === "site" ? id(text(f, "propertyId")) : null;
  const newId = await nextId("inventory_locations");
  await db.batch([asUser(access.user.id), db.insert(inventoryLocations).values({ id: newId, kind, name, propertyId, reportToken: newToken() })]);
  redirect(`/inventory/locations/${newId}`);
}

export async function updateLocation(locationId: number, _prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  const action = text(f, "action");
  if (action === "token") {
    await db.batch([asUser(access.user.id), db.update(inventoryLocations).set({ reportToken: newToken() }).where(eq(inventoryLocations.id, locationId))]);
    refresh();
    return { ok: "New QR code made. Print and replace the old label: it no longer works." };
  }
  if (action === "pars") {
    const entries = [...f.entries()].filter(([k]) => k.startsWith("par-"));
    const rows = entries
      .map(([k, v]) => ({ itemId: Number(k.slice(4)), par: String(v).trim() }))
      .filter((r) => Number.isSafeInteger(r.itemId));
    if (rows.some((r) => r.par !== "" && whole(r.par, 10_000) === null)) return { message: "Pars must be whole numbers." };
    await db.batch([
      asUser(access.user.id),
      db.delete(inventoryPars).where(eq(inventoryPars.locationId, locationId)),
      ...rows.filter((r) => r.par !== "").map((r) => db.insert(inventoryPars).values({ locationId, itemId: r.itemId, par: Number(r.par) })),
    ]);
    refresh();
    return { ok: "Kit saved." };
  }
  if (action === "rename") {
    const name = text(f, "name").slice(0, 80);
    if (!name) return { message: "Enter a name." };
    await db.batch([asUser(access.user.id), db.update(inventoryLocations).set({ name, isActive: text(f, "isActive") !== "false" }).where(eq(inventoryLocations.id, locationId))]);
    refresh();
    return { ok: "Saved." };
  }
  return { message: "Pick what to change." };
}

export async function regenerateAssetToken(assetId: number): Promise<{ message?: string }> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  await db.batch([asUser(access.user.id), db.update(inventoryAssets).set({ reportToken: newToken() }).where(eq(inventoryAssets.id, assetId))]);
  refresh();
  return {};
}

// ---- reports from cleaners ----
export async function submitReport(_prev: Msg, f: FormData): Promise<Msg> {
  const user = await requireUser();
  const locationId = id(text(f, "locationId"));
  const built = await buildReport(f, { locationId });
  if ("error" in built) return { message: built.error };
  await db.batch([
    asUser(user.id),
    db.insert(inventoryReports).values({ ...built.row!, reportedByUserId: user.id, source: "app" }),
    ...(built.marks ? [db.update(inventoryAssets).set({ status: built.marks.status }).where(and(eq(inventoryAssets.id, built.marks.assetId), eq(inventoryAssets.status, "in_service")))] : []),
  ]);
  return { ok: "Thanks! The report was sent." };
}

export async function resolveReport(reportId: number, _prev: Msg, f: FormData): Promise<Msg> {
  const access = await checkPermission("inventory.manage");
  if (!access.user) return { message: access.denied };
  await db
    .update(inventoryReports)
    .set({ status: "resolved", resolvedAt: sql`now()`, resolvedBy: access.user.id, resolution: text(f, "resolution").slice(0, 300) || "Done" })
    .where(eq(inventoryReports.id, reportId));
  refresh();
  return { ok: "Marked done." };
}

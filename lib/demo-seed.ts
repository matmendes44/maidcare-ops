// The public demo's data: wipes the database and fills it with a made-up but
// believable cleaning business around today's date. About four months of
// history and three weeks ahead: customers and leads, properties with service
// plans, visits with crews and vans, invoices and payments, vendors, expenses
// (recurring and one-time), contractors and their pay, inventory with stock,
// equipment and cleaner reports, estimates, and the vans' GPS trips.
//
// Visits in the last 30 days are booked as pending: the fleet sync at the end
// drives the simulated vans to them, and GPS visit detection marks them
// completed, the same way it does with real Bouncie data.
//
// Runs from `npm run demo:seed` and nightly from app/api/demo/reset. Refuses
// to touch a database with any non-demo account in it.
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { company } from "@/lib/company";
import { asUser } from "@/lib/db-helpers";
import { demoUsers, isDemo } from "@/lib/demo";
import { syncFleet } from "@/lib/fleet/sync";
import { fingerprint } from "@/lib/quotes/fingerprint";
import { CONSENT_VERSION, consentText } from "@/lib/quotes/terms";

const TZ = "America/New_York";
const HISTORY_DAYS = 120;
const AHEAD_DAYS = 21;

// ---- dates (Eastern) ----
const dayOf = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(at);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
function offsetHours(day: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(new Date(`${day}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")!.value;
  return Number(name.replace("GMT", "") || 0);
}
// an Eastern wall-clock time on a day, as an ISO instant
const at = (day: string, minutes: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (minutes - offsetHours(day) * 60) * 60_000).toISOString();

// ---- deterministic randomness, so every reset looks the same ----
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261027);
const between = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const token = () => randomBytes(32).toString("hex");
// a row without the fields only the seed uses
function omit<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...row };
  for (const k of keys) delete copy[k];
  return copy;
}

// ---- made-up people and places ----
const FIRST = ["Emma", "Liam", "Olivia", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella", "Lucas", "Mia", "Logan", "Charlotte", "James", "Amelia", "Benjamin", "Harper", "Elijah", "Evelyn", "Henry", "Abigail", "Jack", "Emily", "Owen", "Ella", "Wyatt", "Grace", "Caleb", "Chloe", "Nathan", "Lily", "Isaac", "Zoe", "Ryan", "Nora", "Adam", "Hannah", "Leo", "Layla", "Miles", "Ruby", "Julian"];
const LAST = ["Carter", "Bennett", "Hughes", "Foster", "Reed", "Brooks", "Hayes", "Ward", "Price", "Coleman", "Perry", "Powell", "Long", "Patterson", "Barnes", "Ross", "Fisher", "Henderson", "Jenkins", "Russell", "Griffin", "Bryant", "Simmons", "Wallace", "Woods", "Cole", "West", "Jordan", "Graham", "Reyes", "Sullivan", "Harper", "Ellis", "Murray", "Ford", "Hamilton", "Stone", "Webb", "Tucker", "Porter", "Hunt", "Black"];
// fictional street names, so no address is anyone's real home
const STREETS = ["Juniper Hill Rd", "Harbor Mist Ct", "Willow Bend Dr", "Copper Kettle Ln", "Bayberry Way", "Foxglove Ct", "Saltmarsh Rd", "Lantern Row", "Hollyberry Ln", "Quarry Stone Dr", "Gull Point Ct", "Thistle Down Way", "Mapleleaf Ter", "Cobble Creek Rd", "Sparrow Ridge Ln", "Tidewater Pl", "Amberfield Ct", "Larkspur Dr", "Old Orchard Way", "Riverglass Ln"];
const TOWNS = [
  { city: "Dundalk", zip: "21222", lat: 39.2651, lng: -76.5205, zone: "south" },
  { city: "Glen Burnie", zip: "21061", lat: 39.1626, lng: -76.6247, zone: "south" },
  { city: "Baltimore", zip: "21224", lat: 39.281, lng: -76.578, zone: "city_core" },
  { city: "Baltimore", zip: "21230", lat: 39.279, lng: -76.611, zone: "city_core" },
  { city: "Towson", zip: "21204", lat: 39.4015, lng: -76.6019, zone: "north_northeast" },
  { city: "Parkville", zip: "21234", lat: 39.3773, lng: -76.5394, zone: "north_northeast" },
  { city: "Rosedale", zip: "21237", lat: 39.3201, lng: -76.5155, zone: "north_northeast" },
  { city: "Catonsville", zip: "21228", lat: 39.2721, lng: -76.7319, zone: "northwest" },
  { city: "Pikesville", zip: "21208", lat: 39.3743, lng: -76.7225, zone: "northwest" },
] as const;
const COMPANIES = ["Bayside Coworking", "Greenleaf Pediatrics", "Old Mill Law Office", "Northpoint Dental Studio"];
const ACCESS = ["Lockbox on the side door, code 4417", "Key under the blue planter", "Garage code 2580, then the kitchen door", "Doorman has a key; sign in at the desk", null, null, null];
const SERVICE = ["Friendly dog: keep the back gate closed", "Skip the home office", "Use the customer's own vacuum upstairs", "Extra attention to the kitchen floor", "Fragile glass shelves in the living room", null, null, null];

type Ids = Record<string, number>;
function ids() {
  const next: Ids = {};
  return (table: string) => (next[table] = (next[table] ?? 0) + 1);
}

// Inserts in chunks, each with the demo owner as the user the database
// triggers stamp and audit the change with.
async function insert<T extends PgTable>(table: T, rows: T["$inferInsert"][], userId: number) {
  for (let i = 0; i < rows.length; i += 300) {
    await db.batch([asUser(userId), db.insert(table).values(rows.slice(i, i + 300))]);
  }
}

export type SeedResult = { customers: number; appointments: number; invoices: number; expenses: number; sync: string };

export async function resetDemoData({ sync = true } = {}): Promise<SeedResult> {
  if (!isDemo()) throw new Error("Refusing to seed: DEMO_MODE=1 is not set.");
  const others = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from users where email not in (${demoUsers.owner.email}, ${demoUsers.staff.email})`,
  );
  if (others.rows[0].n > 0) throw new Error("Refusing to seed: this database has non-demo accounts. The demo seed only runs on its own database.");

  // ---- wipe everything (row triggers don't fire on truncate) ----
  const { rows: tables } = await db.execute<{ name: string }>(sql`select tablename as name from pg_tables where schemaname = 'public'`);
  await db.execute(sql.raw(`truncate table ${tables.map((t) => `"${t.name}"`).join(", ")} restart identity cascade`));

  const id = ids();
  const today = dayOf(new Date());
  const now = Date.now();
  const first = addDays(today, -HISTORY_DAYS);

  // ---- people who sign in ----
  const owner = id("users");
  const staff = id("users");
  await db.insert(s.users).values([
    { id: owner, ...demoUsers.owner, role: "owner", passwordHash: await hashPassword(token()) },
    { id: staff, ...demoUsers.staff, role: "staff", passwordHash: await hashPassword(token()) },
  ]);
  await db.insert(s.fleetSync).values({ id: 1 });

  // ---- vans (the simulator's devices) ----
  const vans = [
    { id: id("vehicles"), name: "Van 1", bouncieImei: "990000000000001", plate: "4DX 2201" },
    { id: id("vehicles"), name: "Van 2", bouncieImei: "990000000000002", plate: "4DX 2202" },
  ];
  await insert(s.vehicles, vans, owner);

  // ---- vendors, contractors ----
  const vendorRows: (typeof s.vendors.$inferInsert)[] = [];
  const vendor = (name: string, defaultCategory: string, extra: Partial<typeof s.vendors.$inferInsert> = {}) => {
    const v = { id: id("vendors"), vendorCode: `V${999 + vendorRows.length + 1}`, name, defaultCategory, ...extra };
    vendorRows.push(v);
    return v.id;
  };
  const V = {
    costco: vendor("Costco Wholesale", "supplies", { website: "https://www.costco.com", accountNumber: "111 8402 7713" }),
    uline: vendor("Uline", "supplies", { website: "https://www.uline.com" }),
    homeDepot: vendor("The Home Depot", "equipment", { website: "https://www.homedepot.com" }),
    shell: vendor("Shell", "fuel"),
    jiffy: vendor("Jiffy Lube", "vehicle"),
    insurance: vendor("Chesapeake Mutual Insurance", "insurance", { contactName: "Policy desk", phone: "+14105550188" }),
    google: vendor("Google Workspace", "software", { website: "https://workspace.google.com" }),
    verizon: vendor("Verizon Wireless", "phone"),
    ads: vendor("Google Ads", "marketing"),
    uniforms: vendor("Printful", "uniforms"),
  };
  const crewNames = [
    ["Maria", "Santos"],
    ["Ana", "Oliveira"],
    ["Julia", "Costa"],
    ["Rosa", "Almeida"],
    ["Carla", "Pereira"],
  ];
  const contractorRows = crewNames.map(([firstName, lastName], i) => ({
    id: id("contractors"),
    vendorId: vendor(`${firstName} ${lastName}`, "contractors", { phone: `+1410555${String(170 + i).padStart(4, "0")}` }),
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
    phone: `+1410555${String(170 + i).padStart(4, "0")}`,
    city: pick(TOWNS).city,
    state: "MD",
    taxClassification: "individual" as const,
    tinType: "ssn" as const,
    tinLast4: String(between(1000, 9999)),
    w9ReceivedOn: addDays(first, -between(30, 400)),
    startDate: addDays(first, -between(60, 600)),
    dayRate: [16000, 15000, 15000, 14500, 14000][i],
  }));
  await insert(s.vendors, vendorRows, owner);
  await insert(s.contractors, contractorRows.map((c) => omit(c, "dayRate")), owner);
  await insert(
    s.contractorPayRates,
    contractorRows.map((c) => ({ id: id("contractor_pay_rates"), contractorId: c.id, effectiveFrom: c.startDate, payType: "day_rate" as const, dayRateCents: c.dayRate })),
    owner,
  );
  // two cleaners per van; the fifth fills in on big jobs
  const crews = [[contractorRows[0].id, contractorRows[1].id], [contractorRows[2].id, contractorRows[3].id]];
  const floater = contractorRows[4].id;

  // ---- customers, contacts, properties, plans ----
  type Kind = "active" | "commercial" | "paused" | "inactive" | "lead";
  const kinds: Kind[] = [...Array(30).fill("active"), ...Array(4).fill("commercial"), "paused", "paused", "inactive", "inactive", "inactive", "lead", "lead", "lead"];
  const customers: (typeof s.customers.$inferInsert & { id: number; startDate: string; kind: Kind })[] = [];
  const contacts: (typeof s.contacts.$inferInsert)[] = [];
  const properties: (typeof s.properties.$inferInsert & { id: number; van: number })[] = [];
  const plans: (typeof s.servicePlans.$inferInsert)[] = [];
  kinds.forEach((kind, i) => {
    const cid = id("customers");
    const firstName = FIRST[i % FIRST.length];
    const lastName = LAST[(i * 7) % LAST.length];
    const commercial = kind === "commercial";
    const companyName = commercial ? COMPANIES[i - 30] : null;
    const email = commercial
      ? `office@${companyName!.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`
      : `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;
    const startDate = kind === "lead" ? today : addDays(today, -between(140, 900));
    const endDate = kind === "inactive" ? addDays(today, -between(20, 80)) : null;
    customers.push({
      id: cid,
      kind,
      customerCode: `C${1000 + cid}`,
      type: commercial ? "commercial" : "residential",
      status: kind === "commercial" ? "active" : kind,
      firstName: commercial ? null : firstName,
      lastName: commercial ? null : lastName,
      companyName,
      email,
      stripeCustomerId: kind === "lead" ? null : `cus_demo_${cid}`,
      referredById: i > 3 && i < 30 && chance(0.2) ? between(1, i - 1) : null,
      startDate,
      endDate,
      endReasons: kind === "inactive" ? [pick(["quality", "scheduling_communication", "client_circumstances"] as const)] : [],
      notes: kind === "lead" ? "Asked for a quote through the website." : null,
    });
    contacts.push({
      id: id("contacts"),
      customerId: cid,
      name: commercial ? `${firstName} ${lastName} (office manager)` : `${firstName} ${lastName}`,
      role: commercial ? "Office manager" : null,
      // 555-01XX numbers are reserved for fiction
      phone: `+1410555${String(100 + i).padStart(4, "0")}`,
      email,
      isPrimary: true,
    });
    if (kind === "lead" && i !== 39) return;
    const town = commercial ? pick(TOWNS.filter((t) => t.city === "Baltimore" || t.city === "Towson")) : TOWNS[i % TOWNS.length];
    const pid = id("properties");
    properties.push({
      id: pid,
      customerId: cid,
      street: `${between(100, 9899)} ${STREETS[(i * 3) % STREETS.length]}`,
      unit: commercial ? `Suite ${between(100, 450)}` : null,
      city: town.city,
      state: "MD",
      zip: town.zip,
      lat: (town.lat + (rand() - 0.5) * 0.016).toFixed(6),
      lng: (town.lng + (rand() - 0.5) * 0.02).toFixed(6),
      geocodedAt: new Date(now).toISOString(),
      geocodeStatus: "found",
      zone: town.zone,
      accessNotes: pick(ACCESS),
      serviceNotes: pick(SERVICE),
      van: town.zone === "south" || town.zone === "city_core" ? 0 : 1,
    });
    if (kind === "lead") return;
    const frequency = commercial ? "weekly" : pick(["biweekly", "biweekly", "biweekly", "weekly", "every_4_weeks", "every_4_weeks"] as const);
    plans.push({
      id: id("service_plans"),
      propertyId: pid,
      frequency,
      rateCents: commercial ? between(26, 40) * 1000 : pick([14500, 15500, 17500, 19500, 21000, 23500, 26500]),
      preferredWeekday: between(1, 5),
      defaultPaymentMethod: pick(["stripe", "stripe", "zelle_business", "check"] as const),
      startDate,
      endDate,
    });
  });
  await insert(s.customers, customers.map((c) => omit(c, "kind")), owner);
  await insert(s.contacts, contacts, owner);
  await insert(s.properties, properties.map((p) => omit(p, "van")), owner);
  await db.execute(sql`update customers c set billing_property_id = (select min(p.id) from properties p where p.customer_id = c.id)`);
  await insert(s.servicePlans, plans, owner);

  // ---- visits ----
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const interval = { weekly: 7, biweekly: 14, every_4_weeks: 28 } as Record<string, number>;
  // per van and day, the booked [start, end] minutes
  const booked = new Map<string, [number, number][]>();
  type Visit = typeof s.appointments.$inferInsert & { id: number; day: string; van: number; cleaners: number[] };
  const visits: Visit[] = [];
  for (const plan of plans) {
    const property = propertyById.get(plan.propertyId)!;
    const customer = customerById.get(property.customerId)!;
    const step = interval[plan.frequency];
    const minutes = customer.kind === "commercial" ? 150 : plan.rateCents >= 21000 ? 210 : plan.rateCents >= 17500 ? 180 : 150;
    // a few customers are only booked a few days out, so "recurring visit to
    // book" alerts have something to say
    const horizon = addDays(today, customer.id % 6 === 0 ? 3 : AHEAD_DAYS);
    const until = customer.endDate ?? (customer.kind === "paused" ? addDays(today, -25) : horizon);
    let day = addDays(first, (plan.preferredWeekday! - weekday(first) + 7) % 7);
    day = addDays(day, between(0, step / 7 - 1) * 7);
    for (; day <= until; day = addDays(day, step)) {
      if (day < customer.startDate) continue;
      // first free slot that day, leaving time to drive between houses
      let placed: { day: string; start: number } | null = null;
      for (const shift of [0, 1, -1, 2]) {
        const d = addDays(day, shift);
        if (weekday(d) === 0 || weekday(d) === 6) continue;
        const taken = booked.get(`${property.van}|${d}`) ?? [];
        for (let start = 8 * 60; start + minutes <= 17 * 60 + 30; start += 30) {
          if (taken.every(([a, b]) => start >= b + 40 || start + minutes + 40 <= a)) {
            placed = { day: d, start };
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) continue;
      booked.set(`${property.van}|${placed.day}`, [...(booked.get(`${property.van}|${placed.day}`) ?? []), [placed.start, placed.start + minutes]]);
      const age = daysBetween(placed.day, today);
      const canceled = chance(0.03);
      // older than the first fleet sync reaches: done, with GPS times
      const done = !canceled && age > 29;
      const arrival = placed.start - between(5, 15);
      const departure = placed.start + minutes + between(-10, 10);
      const crew = crews[property.van];
      visits.push({
        id: id("appointments"),
        day: placed.day,
        van: property.van,
        cleaners: minutes >= 210 && chance(0.5) ? [...crew, floater] : crew,
        propertyId: property.id,
        customerId: customer.id,
        servicePlanId: plan.id,
        vehicleId: vans[property.van].id,
        scheduledStart: at(placed.day, placed.start),
        scheduledEnd: at(placed.day, placed.start + minutes),
        actualArrival: done ? at(placed.day, arrival) : null,
        actualDeparture: done ? at(placed.day, departure) : null,
        actualSource: done ? "gps_simulated" : null,
        priceCents: plan.rateCents,
        status: canceled ? "canceled" : done ? "completed" : "pending",
        crewSize: minutes >= 210 ? 3 : 2,
        notes: canceled ? pick(["Customer away this week", "Rescheduled by phone", "Snow day"]) : null,
        createdBy: chance(0.7) ? owner : staff,
      });
    }
  }
  visits.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  await insert(s.appointments, visits.map((v) => omit(v, "day", "van", "cleaners")), owner);
  await insert(s.appointmentVehicles, visits.map((v) => ({ id: id("appointment_vehicles"), appointmentId: v.id, vehicleId: v.vehicleId! })), owner);
  await insert(
    s.appointmentContractors,
    visits.flatMap((v) => v.cleaners.map((contractorId) => ({ id: id("appointment_contractors"), appointmentId: v.id, contractorId }))),
    owner,
  );

  // ---- recurring (memorized) invoices ----
  const label = { weekly: "every week", biweekly: "every 2 weeks", every_4_weeks: "every 4 weeks" } as Record<string, string>;
  await insert(
    s.memorizedInvoices,
    plans.map((p) => {
      const customer = customerById.get(propertyById.get(p.propertyId)!.customerId)!;
      return {
        id: id("memorized_invoices"),
        customerId: customer.id,
        propertyId: p.propertyId,
        frequency: p.frequency as "weekly" | "biweekly" | "every_4_weeks",
        lines: [{ description: `${customer.kind === "commercial" ? "Office cleaning" : "Standard cleaning"}, ${label[p.frequency]}`, cents: p.rateCents }],
        totalCents: p.rateCents,
        isActive: customer.kind !== "inactive",
        pausedUntil: customer.kind === "paused" ? addDays(today, 20) : null,
        source: "invoice" as const,
        createdBy: owner,
      };
    }),
    owner,
  );

  // ---- invoices and payments ----
  const invoices: (typeof s.invoices.$inferInsert)[] = [];
  const payments: (typeof s.payments.$inferInsert)[] = [];
  let number = 1000;
  for (const v of visits) {
    if (v.status === "canceled") continue;
    const age = daysBetween(v.day, today);
    if (age < -7) continue;
    const customer = customerById.get(v.customerId)!;
    const property = propertyById.get(v.propertyId)!;
    const iid = id("invoices");
    const stripeInvoiceId = `in_demo_${iid}`;
    const roll = rand();
    // ahead and today: drafts made when booking; recent: mostly sent, some
    // waiting to be finalized; older: almost all paid
    const status = age <= 0 ? "draft" : age < 14 ? (roll < 0.1 ? "draft" : roll < 0.45 ? "open" : "paid") : roll < 0.05 ? "open" : "paid";
    const finalizedAt = status === "draft" ? null : at(v.day, 19 * 60);
    const paidMs = finalizedAt ? Math.min(Date.parse(finalizedAt) + between(1, 7 * 24) * 3_600_000, now - 3_600_000) : null;
    const paidAt = status === "paid" ? new Date(paidMs!).toISOString() : null;
    const paidVia = status === "paid" ? pick(["stripe", "stripe", "stripe", "check", "cash", "outside_stripe"] as const) : null;
    const name = customer.companyName ?? `${customer.firstName} ${customer.lastName}`;
    invoices.push({
      id: iid,
      stripeInvoiceId,
      number: finalizedAt ? `DEMO-${++number}` : null,
      status,
      stripeCustomerId: customer.stripeCustomerId!,
      customerId: customer.id,
      propertyId: property.id,
      customerName: name,
      customerEmail: customer.email,
      customerAddress: { line1: property.street, line2: property.unit, city: property.city, state: "MD", postal_code: property.zip, country: "US" },
      description: `Cleaning on ${v.day}`,
      totalCents: v.priceCents,
      amountDueCents: v.priceCents,
      amountPaidCents: status === "paid" ? v.priceCents : 0,
      amountRemainingCents: status === "paid" ? 0 : v.priceCents,
      createdAt: at(addDays(v.day, -between(1, 6)), 10 * 60),
      dueDate: finalizedAt ? new Date(Date.parse(finalizedAt) + 7 * 86_400_000).toISOString() : null,
      finalizedAt,
      paidAt,
      paidVia,
      paidViaNote: paidVia === "check" ? `Check #${between(1001, 2400)}` : paidVia === "cash" ? "Cash" : paidVia === "outside_stripe" ? "Zelle" : null,
      paidByUserId: paidVia && paidVia !== "stripe" ? owner : null,
      appointmentId: v.id,
    });
    if (status === "paid")
      payments.push({
        id: id("payments"),
        customerId: customer.id,
        appointmentId: v.id,
        amountCents: v.priceCents,
        method: paidVia === "check" ? "check" : paidVia === "cash" ? "cash" : paidVia === "outside_stripe" ? "zelle_business" : "stripe",
        payerName: name,
        stripeInvoiceId,
        paidAt: paidAt!,
      });
  }
  await insert(s.invoices, invoices, owner);
  await insert(s.payments, payments, owner);

  // ---- expenses ----
  const expenses: (typeof s.expenses.$inferInsert)[] = [];
  const expense = (e: Omit<typeof s.expenses.$inferInsert, "id">) => {
    const row = { id: id("expenses"), ...e };
    expenses.push(row);
    return row.id;
  };
  const card = { paymentMethod: "credit_card", cardBrand: "visa", cardLast4: "4821" } as const;
  const recurring = [
    { vendorId: V.insurance, category: "insurance", amountCents: 31200, amountVaries: false, description: "General liability and bonding" },
    { vendorId: V.google, category: "software", amountCents: 2880, amountVaries: false, description: "Email for two seats" },
    { vendorId: V.verizon, category: "phone", amountCents: 14500, amountVaries: true, description: "Business lines" },
    { vendorId: V.ads, category: "marketing", amountCents: 25000, amountVaries: true, description: "Search ads" },
  ].map((r) => ({ id: id("recurring_expenses"), ...r, frequency: "monthly" as const, startDate: addDays(first, -between(30, 200)), ...card }));
  await insert(s.recurringExpenses, recurring, owner);
  for (const r of recurring)
    for (let day = addDays(first, 3 + (r.id % 20)); day <= today; day = addDays(day, 30))
      expense({ expenseDate: day, vendorId: r.vendorId, category: r.category, amountCents: r.amountVaries ? Math.round(r.amountCents * (0.85 + rand() * 0.3)) : r.amountCents, description: r.description, recurringExpenseId: r.id, ...card });
  // fuel, weekly per van
  for (let day = addDays(first, 1); day <= today; day = addDays(day, 7))
    for (const van of vans) expense({ expenseDate: day, vendorId: V.shell, category: "fuel", amountCents: between(5200, 8600), description: `${van.name} fill-up`, ...card });
  // oil changes
  const services: (typeof s.vehicleServiceRecords.$inferInsert)[] = [];
  for (const [i, van] of vans.entries()) {
    const day = addDays(today, -(40 + i * 25));
    expense({ expenseDate: day, vendorId: V.jiffy, category: "vehicle", amountCents: 8999, description: `${van.name} oil change`, ...card });
    services.push({ id: id("vehicle_service_records"), vehicleId: van.id, performedOn: day, odometer: 28_000 + i * 6000 + between(4000, 9000), note: "Synthetic oil change and tire rotation", createdBy: owner });
  }
  await insert(s.vehicleServiceRecords, services, owner);
  // uniforms, once
  expense({ expenseDate: addDays(first, 10), vendorId: V.uniforms, category: "uniforms", amountCents: 41800, description: "Ten polos with the logo", ...card });
  // what each cleaner earned, paid on Fridays for the week before
  const workedDays = new Map<number, Set<string>>();
  for (const v of visits)
    if (v.status !== "canceled" && v.day < today) for (const c of v.cleaners) workedDays.set(c, (workedDays.get(c) ?? new Set()).add(v.day));
  for (const c of contractorRows)
    for (let friday = addDays(first, (5 - weekday(first) + 7) % 7 + 7); friday <= today; friday = addDays(friday, 7)) {
      const days = [...(workedDays.get(c.id) ?? [])].filter((d) => d >= addDays(friday, -7) && d < friday).length;
      if (days) expense({ expenseDate: friday, vendorId: c.vendorId, category: "contractors", amountCents: days * c.dayRate, paymentMethod: "zelle", reference: `Week of ${addDays(friday, -7)}`, description: `${days} day${days > 1 ? "s" : ""} at $${c.dayRate / 100}` });
    }

  // ---- inventory ----
  const items = [
    { name: "All-purpose cleaner", kind: "supply", category: "chemicals", unit: "bottle", vehiclePar: 4, reorderPoint: 8, reorderQuantity: 24, unitCostCents: 449, vendor: V.costco },
    { name: "Glass cleaner", kind: "supply", category: "chemicals", unit: "bottle", vehiclePar: 3, reorderPoint: 6, reorderQuantity: 18, unitCostCents: 399, vendor: V.costco },
    { name: "Disinfectant spray", kind: "supply", category: "chemicals", unit: "bottle", vehiclePar: 4, reorderPoint: 8, reorderQuantity: 24, unitCostCents: 629, vendor: V.costco },
    { name: "Bathroom cleaner", kind: "supply", category: "chemicals", unit: "bottle", vehiclePar: 3, reorderPoint: 6, reorderQuantity: 18, unitCostCents: 489, vendor: V.costco },
    { name: "Floor cleaner concentrate", kind: "supply", category: "chemicals", unit: "gallon", vehiclePar: 1, reorderPoint: 2, reorderQuantity: 4, unitCostCents: 1899, vendor: V.uline },
    { name: "Trash bags", kind: "supply", category: "liners", unit: "box", vehiclePar: 1, reorderPoint: 3, reorderQuantity: 6, unitCostCents: 2199, vendor: V.costco },
    { name: "Nitrile gloves", kind: "supply", category: "ppe", unit: "box", vehiclePar: 2, reorderPoint: 4, reorderQuantity: 10, unitCostCents: 1299, vendor: V.uline },
    { name: "Paper towels", kind: "supply", category: "paper", unit: "case", vehiclePar: 1, reorderPoint: 2, reorderQuantity: 4, unitCostCents: 2499, vendor: V.costco },
    { name: "Scrub sponges", kind: "supply", category: "tools", unit: "pack", vehiclePar: 2, reorderPoint: 4, reorderQuantity: 10, unitCostCents: 899, vendor: V.costco },
    { name: "Microfiber cloths", kind: "reusable", category: "cloths", unit: "pack", vehiclePar: 3, reorderPoint: 4, reorderQuantity: 8, unitCostCents: 1999, vendor: V.costco },
    { name: "Mop pads", kind: "reusable", category: "cloths", unit: "pack", vehiclePar: 2, reorderPoint: 3, reorderQuantity: 6, unitCostCents: 1599, vendor: V.uline },
    { name: "Spray bottles", kind: "reusable", category: "bottles", unit: "each", vehiclePar: 6, reorderPoint: 6, reorderQuantity: 12, unitCostCents: 299, vendor: V.uline },
    { name: "Backpack vacuum", kind: "equipment", category: "vacuums", unit: "each", vehiclePar: 0, reorderPoint: 0, reorderQuantity: 0, unitCostCents: 32900, vendor: V.homeDepot, serviceIntervalDays: 90, usefulLifeMonths: 36 },
    { name: "Carpet spot extractor", kind: "equipment", category: "machines", unit: "each", vehiclePar: 0, reorderPoint: 0, reorderQuantity: 0, unitCostCents: 18900, vendor: V.homeDepot, serviceIntervalDays: 180, usefulLifeMonths: 48 },
  ].map(({ vendor: preferredVendorId, ...it }) => ({ id: id("inventory_items"), ...it, kind: it.kind as "supply" | "reusable" | "equipment", preferredVendorId, createdBy: owner }));
  await insert(s.inventoryItems, items, owner);
  const storage = { id: id("inventory_locations"), kind: "storage" as const, name: "Main storage", reportToken: token() };
  const vanSpots = vans.map((v) => ({ id: id("inventory_locations"), kind: "vehicle" as const, name: v.name, vehicleId: v.id, reportToken: token() }));
  const office = properties.find((p) => customerById.get(p.customerId)!.companyName === "Bayside Coworking")!;
  const site = { id: id("inventory_locations"), kind: "site" as const, name: "Bayside Coworking supply closet", propertyId: office.id, reportToken: token() };
  await insert(s.inventoryLocations, [storage, ...vanSpots, site], owner);
  await insert(s.inventoryPars, items.filter((it) => it.category === "paper" || it.category === "liners").map((it) => ({ locationId: site.id, itemId: it.id, par: 2 })), owner);

  // stock as a ledger: buy into storage every two weeks, restock the vans
  // weekly, use some each week; glass cleaner runs low on purpose
  const movements: (typeof s.inventoryMovements.$inferInsert)[] = [];
  const stock = new Map<string, number>();
  const has = (itemId: number, loc: number) => stock.get(`${itemId}|${loc}`) ?? 0;
  const move = (m: Omit<typeof s.inventoryMovements.$inferInsert, "id">) => {
    if (m.fromLocationId) stock.set(`${m.itemId}|${m.fromLocationId}`, has(m.itemId, m.fromLocationId) - m.quantity);
    if (m.toLocationId) stock.set(`${m.itemId}|${m.toLocationId}`, has(m.itemId, m.toLocationId) + m.quantity);
    movements.push({ id: id("inventory_movements"), createdBy: owner, ...m });
  };
  const supplies = items.filter((it) => it.kind !== "equipment");
  for (let day = first, n = 0; day <= today; day = addDays(day, 7), n++) {
    const stamp = at(day, 9 * 60);
    if (n % 2 === 0) {
      const bought = supplies.filter((it) => has(it.id, storage.id) <= it.reorderPoint + 4 && !(it.name === "Glass cleaner" && daysBetween(day, today) < 30));
      if (bought.length) {
        const expenseId = expense({
          expenseDate: day,
          vendorId: V.costco,
          category: "supplies",
          amountCents: bought.reduce((sum, it) => sum + it.reorderQuantity * it.unitCostCents!, 0),
          description: `Restock: ${bought.map((it) => it.name.toLowerCase()).join(", ")}`,
          ...card,
        });
        for (const it of bought) move({ itemId: it.id, kind: "purchase", quantity: it.reorderQuantity, toLocationId: storage.id, unitCostCents: it.unitCostCents, expenseId, createdAt: stamp });
      }
    }
    for (const spot of vanSpots)
      for (const it of supplies) {
        const used = Math.min(has(it.id, spot.id), between(0, Math.max(1, Math.ceil(it.vehiclePar / 2))));
        if (used > 0 && it.kind === "supply") move({ itemId: it.id, kind: "use", quantity: used, fromLocationId: spot.id, unitCostCents: it.unitCostCents, createdAt: stamp });
        const short = it.vehiclePar - has(it.id, spot.id);
        const sent = Math.min(short, has(it.id, storage.id));
        if (sent > 0) move({ itemId: it.id, kind: "transfer", quantity: sent, fromLocationId: storage.id, toLocationId: spot.id, createdAt: at(day, 7 * 60) });
      }
  }
  // equipment: bought together, one asset per unit
  const vacuums = items.find((it) => it.name === "Backpack vacuum")!;
  const extractor = items.find((it) => it.name === "Carpet spot extractor")!;
  const boughtOn = addDays(first, -60);
  const equipmentExpense = expense({ expenseDate: boughtOn, vendorId: V.homeDepot, category: "equipment", amountCents: 4 * vacuums.unitCostCents! + extractor.unitCostCents!, description: "Four backpack vacuums and a spot extractor", ...card });
  const assets = [
    ...[0, 1, 2, 3].map((n) => ({ item: vacuums, tag: `VAC-00${n + 1}`, location: vanSpots[n < 2 ? 0 : 1].id, status: "in_service" as const })),
    { item: extractor, tag: "EXT-001", location: storage.id, status: "needs_repair" as const },
  ].map((a) => ({
    id: id("inventory_assets"),
    assetTag: a.tag,
    itemId: a.item.id,
    serialNumber: `SN${between(100000, 999999)}`,
    locationId: a.location,
    status: a.status,
    expenseId: equipmentExpense,
    purchaseCostCents: a.item.unitCostCents!,
    purchasedOn: boughtOn,
    warrantyUntil: addDays(boughtOn, 365),
    lastServicedOn: addDays(today, -between(20, 85)),
    reportToken: token(),
    createdBy: owner,
  }));
  await insert(s.expenses, expenses, owner);
  await insert(s.inventoryMovements, movements, owner);
  await insert(s.inventoryAssets, assets, owner);
  await insert(
    s.inventoryAssetEvents,
    assets.flatMap((a) => [
      { id: id("inventory_asset_events"), assetId: a.id, kind: "added" as const, toLocationId: a.locationId, expenseId: equipmentExpense, createdAt: at(boughtOn, 15 * 60), createdBy: owner },
      { id: id("inventory_asset_events"), assetId: a.id, kind: "serviced" as const, note: "Filter and belt replaced", createdAt: at(a.lastServicedOn, 16 * 60), createdBy: owner },
      ...(a.status === "needs_repair" ? [{ id: id("inventory_asset_events"), assetId: a.id, kind: "status" as const, status: "needs_repair", note: "Pump stopped priming", createdAt: at(addDays(today, -3), 12 * 60), createdBy: staff }] : []),
    ]),
    owner,
  );
  const glass = items.find((it) => it.name === "Glass cleaner")!;
  await insert(
    s.inventoryReports,
    [
      { id: id("inventory_reports"), kind: "low" as const, itemId: glass.id, locationId: vanSpots[1].id, note: "Last bottle", reporterName: "Julia Costa", contractorId: contractorRows[2].id, source: "qr" as const, createdAt: at(addDays(today, -1), 16 * 60) },
      { id: id("inventory_reports"), kind: "broken" as const, assetId: assets[4].id, locationId: storage.id, note: "Pump stopped priming", reportedByUserId: staff, source: "app" as const, createdAt: at(addDays(today, -3), 12 * 60) },
      { id: id("inventory_reports"), kind: "out" as const, itemId: items[5].id, locationId: vanSpots[0].id, reporterName: "Maria Santos", contractorId: contractorRows[0].id, source: "qr" as const, status: "resolved" as const, resolvedAt: at(addDays(today, -8), 9 * 60), resolvedBy: owner, resolution: "Restocked from storage", createdAt: at(addDays(today, -9), 15 * 60) },
    ],
    owner,
  );

  // ---- estimates ----
  const leads = customers.filter((c) => c.kind === "lead");
  const newest = customers.filter((c) => c.kind === "active").sort((a, b) => b.startDate!.localeCompare(a.startDate!))[0];
  const content = (title: string, first: number, recurring: number) => ({
    title,
    intro: "Pick one of the options below. Prices are per visit.",
    areas: ["Whole house: 3 bedrooms, 2 bathrooms, kitchen, living and dining rooms"],
    options: [
      { id: "o1", name: "Option 1: Deep clean first", description: "A top-to-bottom deep clean, then standard visits", priceCents: first, recurringCents: recurring },
      { id: "o2", name: "Option 2: Standard from the start", description: "Standard cleaning every visit", priceCents: recurring + 3000, recurringCents: recurring },
    ],
    included: {
      columns: ["Standard", "Deep clean"],
      tasks: [
        { label: "Dusting of reachable surfaces", marks: [true, true] },
        { label: "Kitchen counters, sink and appliance exteriors", marks: [true, true] },
        { label: "Bathrooms: toilets, tubs, showers and mirrors", marks: [true, true] },
        { label: "Vacuuming and mopping of all floors", marks: [true, true] },
        { label: "Baseboards and window sills", marks: [false, true] },
        { label: "Inside the oven", marks: [false, true] },
      ],
    },
    addOns: [
      { id: "a1", name: "Inside the fridge", description: "Shelves and drawers wiped and organized", priceCents: 4500, kind: "optional" as const },
      { id: "a2", name: "Laundry (1 load)", description: "Washed, dried and folded", priceCents: 3000, kind: "on_request" as const },
    ],
    recurringTitle: "Recurring cleaning options",
    recurringIntro: "After the first visit:",
    recurring: [{ name: "Standard cleaning", description: "Every 2 weeks", when: "Every 2 weeks", priceCents: recurring }],
    notes: ["Prices are per visit.", "Supplies and equipment included."],
    taxBp: 0,
  });
  const quotes = [
    { customer: newest, status: "accepted", sentDaysAgo: 12, content: content("First-time deep clean + biweekly", 32500, 17500) },
    { customer: leads[0], status: "sent", sentDaysAgo: 2, viewed: true, content: content("Deep clean and recurring service", 34500, 19500) },
    { customer: leads[1], status: "sent", sentDaysAgo: 1, content: content("Move-in cleaning", 41000, 21000) },
    { customer: leads[2], status: "draft", content: content("Weekly cleaning", 29500, 15500) },
    { customer: customers.find((c) => c.kind === "inactive")!, status: "declined", sentDaysAgo: 40, content: content("Spring deep clean", 36000, 18000) },
  ].map((q, i) => ({ ...q, id: id("quotes"), quoteNumber: 10490 + i, publicToken: token() }));
  await insert(
    s.quotes,
    quotes.map((q) => {
      const sentAt = q.sentDaysAgo != null ? at(addDays(today, -q.sentDaysAgo), 11 * 60) : null;
      return {
        id: q.id,
        quoteNumber: q.quoteNumber,
        customerId: q.customer.id,
        propertyId: properties.find((p) => p.customerId === q.customer.id)?.id ?? null,
        content: q.content,
        status: q.status as "draft" | "sent" | "accepted" | "declined",
        validUntil: addDays(today, q.status === "declined" ? -10 : 30),
        publicToken: q.publicToken,
        sentAt,
        firstViewedAt: q.status === "accepted" || q.status === "declined" || q.viewed ? at(addDays(today, -(q.sentDaysAgo ?? 0)), 18 * 60) : null,
        lastViewedAt: q.status === "accepted" || q.status === "declined" || q.viewed ? at(addDays(today, -(q.sentDaysAgo ?? 0) + 1), 8 * 60) : null,
        viewCount: q.status === "draft" || (q.status === "sent" && !q.viewed) ? 0 : between(2, 5),
        acceptedAt: q.status === "accepted" ? at(addDays(today, -(q.sentDaysAgo! - 1)), 9 * 60) : null,
        declinedAt: q.status === "declined" ? at(addDays(today, -(q.sentDaysAgo! - 3)), 9 * 60) : null,
        declineReason: q.status === "declined" ? "Went with someone closer to home" : null,
        createdBy: staff,
      };
    }),
    owner,
  );
  const events: (typeof s.quoteEvents.$inferInsert)[] = [];
  for (const q of quotes) {
    const sent = q.sentDaysAgo != null ? addDays(today, -q.sentDaysAgo) : today;
    events.push({ id: id("quote_events"), quoteId: q.id, kind: "created", createdAt: at(sent, 10 * 60), createdBy: staff });
    if (q.status === "draft") continue;
    events.push({ id: id("quote_events"), quoteId: q.id, kind: "sent", createdAt: at(sent, 11 * 60), createdBy: staff });
    if (q.status !== "sent" || q.viewed) events.push({ id: id("quote_events"), quoteId: q.id, kind: "viewed", createdAt: at(sent, 18 * 60) });
    if (q.status === "accepted") events.push({ id: id("quote_events"), quoteId: q.id, kind: "accepted", detail: { option: q.content.options[0].name, addOns: [], totalCents: q.content.options[0].priceCents, signerName: `${q.customer.firstName} ${q.customer.lastName}` }, createdAt: at(addDays(sent, 1), 9 * 60) });
    if (q.status === "declined") events.push({ id: id("quote_events"), quoteId: q.id, kind: "declined", detail: { reason: "Went with someone closer to home" }, createdAt: at(addDays(sent, 3), 9 * 60) });
  }
  await insert(s.quoteEvents, events, owner);
  const accepted = quotes[0];
  const acceptedProperty = properties.find((p) => p.customerId === accepted.customer.id)!;
  const snapshot = {
    quoteNumber: accepted.quoteNumber,
    version: 1,
    validUntil: addDays(today, 30),
    preparedFor: { name: `${accepted.customer.firstName} ${accepted.customer.lastName}`, address: `${acceptedProperty.street}, ${acceptedProperty.city}, MD ${acceptedProperty.zip}` },
    company,
    content: accepted.content,
  };
  await db.insert(s.quoteAcceptances).values({
    id: id("quote_acceptances"),
    quoteId: accepted.id,
    quoteVersion: 1,
    optionId: "o1",
    optionName: accepted.content.options[0].name,
    totalCents: accepted.content.options[0].priceCents,
    signerName: snapshot.preparedFor.name,
    verifiedBy: "email",
    consentVersion: CONSENT_VERSION,
    consentText: consentText().join("\n\n"),
    snapshot,
    snapshotSha256: fingerprint(snapshot),
    acceptedAt: at(addDays(today, -11), 9 * 60),
  });

  // ---- a few things for the bell ----
  await insert(
    s.notifications,
    [
      { id: id("notifications"), kind: "quote_viewed", title: "Estimate #{number} was opened", body: "The customer is looking at it now.", href: `/finances/estimates/${quotes[1].id}`, vars: { number: quotes[1].quoteNumber }, createdAt: at(addDays(today, -2), 18 * 60) },
      { id: id("notifications"), kind: "inventory_report", title: "Running low: {item}", body: "Reported from Van 2's QR code.", href: "/inventory", vars: { item: "Glass cleaner" }, createdAt: at(addDays(today, -1), 16 * 60) },
    ],
    owner,
  );

  // ids were given explicitly: move every sequence past them
  await db.execute(sql`do $$ declare r record; begin
    for r in select c.table_name from information_schema.columns c
              where c.table_schema = 'public' and c.column_name = 'id' and c.column_default like 'nextval%' loop
      execute format('select setval(pg_get_serial_sequence(%L, ''id''), greatest(coalesce((select max(id) from %I), 0), 1))', r.table_name, r.table_name);
    end loop;
  end $$`);

  // the vans drive the last 30 days; GPS marks those visits completed
  let synced = "skipped";
  if (sync) {
    const result = await syncFleet({ force: true });
    synced = result.status === "synced" ? `${result.trips} trips, ${result.visits} visits timed` : result.status === "failed" ? `failed: ${result.error}` : result.status;
  }
  return { customers: customers.length, appointments: visits.length, invoices: invoices.length, expenses: expenses.length, sync: synced };
}

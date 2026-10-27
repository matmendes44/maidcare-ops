import { pgTable, primaryKey, foreignKey, unique, check, bigserial, text, bigint, timestamp, index, uniqueIndex, boolean, char, numeric, integer, smallint, date, pgView, pgEnum, jsonb, customType, doublePrecision, type PgTableExtraConfigValue } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// Binary data. The HTTP driver returns bytea as a "\\x…" hex string, so it's
// converted to and from a Buffer here.
const bytea = customType<{ data: Buffer; driverData: string | Buffer }>({
	dataType: () => "bytea",
	toDriver: (value) => `\\x${value.toString("hex")}`,
	fromDriver: (value) =>
		Buffer.isBuffer(value) ? value : Buffer.from(String(value).replace(/^\\x/, ""), "hex"),
});

export const customerStatus = pgEnum("customer_status", ['lead', 'active', 'paused', 'inactive'])
export const endReason = pgEnum("end_reason", ['quality', 'scheduling_communication', 'client_circumstances'])
export const customerType = pgEnum("customer_type", ['residential', 'commercial', 'referral_partner'])
export const frequency = pgEnum("frequency", ['one_time', 'weekly', 'biweekly', 'every_4_weeks', 'monthly', 'every_2_months'])
export const payMethod = pgEnum("pay_method", ['stripe', 'zelle_business', 'zelle_personal', 'venmo', 'check', 'cash', 'other'])
export const serviceZone = pgEnum("service_zone", ['south', 'northwest', 'city_core', 'north_northeast', 'other'])


export const customers = pgTable("customers", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	customerCode: text("customer_code").notNull(),
	type: customerType().default('residential').notNull(),
	status: customerStatus().default('lead').notNull(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	companyName: text("company_name"),
	email: text(),
	stripeCustomerId: text("stripe_customer_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	referredById: bigint("referred_by_id", { mode: "number" }),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	startDate: date("start_date").default(sql`CURRENT_DATE`).notNull(),
	endDate: date("end_date"),
	endReasons: endReason("end_reasons").array().default(sql`'{}'`).notNull(),
	// One of the customer's own properties (enforced by the composite foreign
	// key below). Cleared automatically if that property is deleted.
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	billingPropertyId: bigint("billing_property_id", { mode: "number" }),
	// Why the last attempt to update this customer in Stripe failed; null when
	// Stripe has their current details (lib/stripe-customers.ts).
	stripeSyncError: text("stripe_sync_error"),
// annotated because customers and properties reference each other, which
// TypeScript can't infer on its own
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.referredById],
			foreignColumns: [table.id],
			name: "customers_referred_by_id_fkey"
		}),
	// The migration uses ON DELETE SET NULL ("billing_property_id"): drizzle can
	// only null every column of the key, which would include customers.id.
	foreignKey({
			columns: [table.billingPropertyId, table.id],
			foreignColumns: [properties.id, properties.customerId],
			name: "customers_billing_property_fkey"
		}).onDelete("set null"),
	unique("customers_customer_code_key").on(table.customerCode),
	unique("customers_stripe_customer_id_key").on(table.stripeCustomerId),
	check("customers_check", sql`(first_name IS NOT NULL) OR (company_name IS NOT NULL)`),
	check("customers_end_date_status_check", sql`(status = 'inactive'::customer_status) = (end_date IS NOT NULL)`),
	check("customers_end_after_start_check", sql`(end_date IS NULL) OR (end_date >= start_date)`),
	check("customers_end_reasons_status_check", sql`(status = 'inactive'::customer_status) OR (cardinality(end_reasons) = 0)`),
]);

export const contacts = pgTable("contacts", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	customerId: bigint("customer_id", { mode: "number" }).notNull(),
	name: text(),
	role: text(),
	phone: text(),
	email: text(),
	isPrimary: boolean("is_primary").default(false).notNull(),
	smsOptIn: boolean("sms_opt_in").default(true).notNull(),
}, (table) => [
	index("contacts_phone").using("btree", table.phone.asc().nullsLast().op("text_ops")),
	index("contacts_customer_id").using("btree", table.customerId.asc().nullsLast().op("int8_ops")),
	uniqueIndex("one_primary_contact").using("btree", table.customerId.asc().nullsLast().op("int8_ops")).where(sql`is_primary`),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "contacts_customer_id_fkey"
		}).onDelete("cascade"),
]);

export const properties = pgTable("properties", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	customerId: bigint("customer_id", { mode: "number" }).notNull(),
	street: text().notNull(),
	unit: text(),
	city: text().notNull(),
	state: char({ length: 2 }).default('MD').notNull(),
	zip: char({ length: 5 }).notNull(),
	lat: numeric({ precision: 9, scale:  6 }),
	lng: numeric({ precision: 9, scale:  6 }),
	// When lat/lng were looked up from the address (lib/geocode.ts), and
	// whether the address was found; cleared when the address changes.
	geocodedAt: timestamp("geocoded_at", { withTimezone: true, mode: 'string' }),
	geocodeStatus: text("geocode_status", { enum: ["found", "not_found"] }),
	zone: serviceZone(),
	accessNotes: text("access_notes"),
	serviceNotes: text("service_notes"),
	isActive: boolean("is_active").default(true).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "properties_customer_id_fkey"
		}).onDelete("cascade"),
	check("properties_zip_check", sql`zip ~ '^\\d{5}$'::text`),
	check("properties_geocode_status_check", sql`geocode_status = ANY (ARRAY['found'::text, 'not_found'::text])`),
	index("properties_customer_id").using("btree", table.customerId.asc().nullsLast().op("int8_ops")),
	// target of customers_billing_property_fkey
	unique("properties_id_customer_id_key").on(table.id, table.customerId),
]);

export const servicePlans = pgTable("service_plans", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	propertyId: bigint("property_id", { mode: "number" }).notNull(),
	frequency: frequency().notNull(),
	rateCents: integer("rate_cents").notNull(),
	preferredWeekday: smallint("preferred_weekday"),
	weeksOfMonth: smallint("weeks_of_month").array(),
	defaultPaymentMethod: payMethod("default_payment_method"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	startDate: date("start_date").default(sql`CURRENT_DATE`).notNull(),
	endDate: date("end_date"),
}, (table) => [
	uniqueIndex("one_open_plan_per_property").using("btree", table.propertyId.asc().nullsLast().op("int8_ops")).where(sql`(end_date IS NULL)`),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "service_plans_property_id_fkey"
		}).onDelete("cascade"),
	unique("service_plans_stripe_subscription_id_key").on(table.stripeSubscriptionId),
	check("service_plans_rate_cents_check", sql`rate_cents >= 0`),
	check("service_plans_preferred_weekday_check", sql`(preferred_weekday >= 0) AND (preferred_weekday <= 6)`),
	check("service_plans_check", sql`(end_date IS NULL) OR (end_date >= start_date)`),
]);

export const visitHistory = pgTable("visit_history", {
	customerCode: text("customer_code"),
	visitDate: timestamp("visit_date", { mode: 'string' }),
	arrival: text(),
	departure: text(),
	calendarLabel: text("calendar_label"),
});

export const payments = pgTable("payments", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	customerId: bigint("customer_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	appointmentId: bigint("appointment_id", { mode: "number" }),
	amountCents: integer("amount_cents").notNull(),
	method: payMethod().notNull(),
	payerName: text("payer_name"),
	stripeInvoiceId: text("stripe_invoice_id"),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("payments_customer_paid").using("btree", table.customerId.asc().nullsLast().op("int8_ops"), table.paidAt.desc().nullsFirst().op("int8_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "payments_customer_id_fkey"
		}),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "payments_appointment_id_fkey"
		}),
	unique("payments_stripe_invoice_id_key").on(table.stripeInvoiceId),
]);

export const appointments = pgTable("appointments", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	propertyId: bigint("property_id", { mode: "number" }).notNull(),
	// Who the visit is for, fixed when it's booked: it stays with this customer
	// if the property is later transferred. Must own the property at booking
	// (checked by the app, not a foreign key, so history survives transfers).
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	customerId: bigint("customer_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	servicePlanId: bigint("service_plan_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	vehicleId: bigint("vehicle_id", { mode: "number" }),
	scheduledStart: timestamp("scheduled_start", { withTimezone: true, mode: 'string' }).notNull(),
	scheduledEnd: timestamp("scheduled_end", { withTimezone: true, mode: 'string' }).notNull(),
	actualArrival: timestamp("actual_arrival", { withTimezone: true, mode: 'string' }),
	actualDeparture: timestamp("actual_departure", { withTimezone: true, mode: 'string' }),
	// The times first booked, kept when GPS moves today's scheduled times to
	// when the crew actually arrived and left (lib/fleet/sync.ts).
	bookedStart: timestamp("booked_start", { withTimezone: true, mode: 'string' }),
	bookedEnd: timestamp("booked_end", { withTimezone: true, mode: 'string' }),
	crew: text(),
	priceCents: integer("price_cents").notNull(),
	status: text({ enum: ["pending", "in_progress", "completed", "canceled"] }).default('pending').notNull(),
	gcalEventId: text("gcal_event_id"),
	crewSize: smallint("crew_size"),
	actualSource: text("actual_source"),
	notes: text(),
	// System information. created_by/updated_by/updated_at are filled in by the
	// stamp_appointment trigger from the app.user_id setting (see
	// lib/db-helpers.ts); rows imported before tracking have no created_at.
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	index("appointments_property_start").using("btree", table.propertyId.asc().nullsLast().op("int8_ops"), table.scheduledStart.asc().nullsLast().op("int8_ops")),
	index("appointments_customer_start").using("btree", table.customerId.asc().nullsLast().op("int8_ops"), table.scheduledStart.asc().nullsLast().op("timestamptz_ops")),
	index("appointments_start").using("btree", table.scheduledStart.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "appointments_customer_id_fkey"
		}),
	foreignKey({
			columns: [table.vehicleId],
			foreignColumns: [vehicles.id],
			name: "appointments_vehicle_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "appointments_created_by_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "appointments_updated_by_fkey"
		}),
	check("appointments_end_after_start_check", sql`scheduled_end > scheduled_start`),
	// (appointments_vehicle_no_overlap was dropped in 0021: GPS moves today's
	// times as the crew works through the day in any order. A vehicle may be
	// booked on overlapping visits; GPS sets the ones that came when it's done.)
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "appointments_property_id_fkey"
		}),
	foreignKey({
			columns: [table.servicePlanId],
			foreignColumns: [servicePlans.id],
			name: "appointments_service_plan_id_fkey"
		}),
	unique("appointments_gcal_event_id_key").on(table.gcalEventId),
	check("appointments_status_check", sql`status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'canceled'::text])`),
	check("appointments_crew_size_check", sql`(crew_size >= 1) AND (crew_size <= 6)`),
	// gps: detected from Bouncie trips (Fleet page); gps_simulated: the same,
	// from the development simulator
	check("appointments_actual_source_check", sql`actual_source = ANY (ARRAY['gps'::text, 'gps_simulated'::text, 'manual'::text, 'gcal_backfill'::text])`),
	check("actual_times_in_order", sql`(actual_arrival IS NULL) OR (actual_departure IS NULL) OR (actual_departure > actual_arrival)`),
]);

export const gpsTrips = pgTable("gps_trips", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	vehicle: text().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }).notNull(),
	startAddress: text("start_address"),
	endAddress: text("end_address"),
	endLat: numeric("end_lat", { precision: 9, scale:  6 }),
	endLng: numeric("end_lng", { precision: 9, scale:  6 }),
	miles: numeric({ precision: 7, scale:  2 }),
	fuelGal: numeric("fuel_gal", { precision: 6, scale:  3 }),
	sourceFile: text("source_file"),
	importedAt: timestamp("imported_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("gps_trips_vehicle_started_at_key").on(table.startedAt, table.vehicle),
]);

export const gpsStops = pgTable("gps_stops", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	vehicle: text().notNull(),
	arrivedAt: timestamp("arrived_at", { withTimezone: true, mode: 'string' }).notNull(),
	departedAt: timestamp("departed_at", { withTimezone: true, mode: 'string' }).notNull(),
	address: text(),
	lat: numeric({ precision: 9, scale:  6 }),
	lng: numeric({ precision: 9, scale:  6 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	propertyId: bigint("property_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	appointmentId: bigint("appointment_id", { mode: "number" }),
	distanceM: integer("distance_m"),
	confidence: text().notNull(),
	resolved: boolean().default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "gps_stops_property_id_fkey"
		}),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "gps_stops_appointment_id_fkey"
		}),
	unique("gps_stops_vehicle_arrived_at_key").on(table.arrivedAt, table.vehicle),
	check("gps_stops_confidence_check", sql`confidence = ANY (ARRAY['high'::text, 'medium'::text, 'review'::text, 'no_match'::text])`),
]);
export const dataIssues = pgView("data_issues", {	issue: text(),
	customerCode: text("customer_code"),
	client: text(),
	detail: text(),
}).as(sql`SELECT 'no property'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, NULL::text AS detail FROM customers c WHERE c.status = 'active'::customer_status AND NOT (EXISTS ( SELECT 1 FROM properties p WHERE p.customer_id = c.id)) UNION ALL SELECT 'no service plan'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, p.street AS detail FROM properties p JOIN customers c ON c.id = p.customer_id WHERE p.is_active AND NOT (EXISTS ( SELECT 1 FROM service_plans sp WHERE sp.property_id = p.id AND sp.end_date IS NULL)) UNION ALL SELECT 'no primary phone'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, NULL::text AS detail FROM customers c WHERE c.status = 'active'::customer_status AND NOT (EXISTS ( SELECT 1 FROM contacts ct WHERE ct.customer_id = c.id AND ct.is_primary AND ct.phone IS NOT NULL)) UNION ALL SELECT 'shared phone'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, ct.phone AS detail FROM contacts ct JOIN customers c ON c.id = ct.customer_id WHERE (ct.phone IN ( SELECT contacts.phone FROM contacts WHERE contacts.phone IS NOT NULL GROUP BY contacts.phone HAVING count(DISTINCT contacts.customer_id) > 1)) UNION ALL SELECT 'shared address'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, p.street AS detail FROM properties p JOIN customers c ON c.id = p.customer_id WHERE (lower(p.street) IN ( SELECT lower(properties.street) AS lower FROM properties GROUP BY (lower(properties.street)) HAVING count(DISTINCT properties.customer_id) > 1)) UNION ALL SELECT 'visit priced $0'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text) AS detail FROM appointments a JOIN properties p ON p.id = a.property_id JOIN customers c ON c.id = p.customer_id WHERE a.status = 'completed'::text AND a.price_cents = 0 UNION ALL SELECT 'odd duration'::text AS issue, visit_durations.customer_code, visit_durations.client, ((visit_durations.visit_date || ': '::text) || visit_durations.onsite_min) || ' min'::text AS detail FROM visit_durations WHERE visit_durations.onsite_min < 30 OR visit_durations.onsite_min > 360 UNION ALL SELECT 'double-booked day'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text) AS detail FROM appointments a JOIN properties p ON p.id = a.property_id JOIN customers c ON c.id = p.customer_id WHERE a.status <> 'cancelled'::text GROUP BY c.customer_code, (concat_ws(' '::text, c.first_name, c.last_name, c.company_name)), a.property_id, (to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text)) HAVING count(*) > 1 UNION ALL SELECT 'active, no visit in 60 days'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, COALESCE('last: '::text || max((a.actual_arrival AT TIME ZONE 'America/New_York'::text)::date)::text, 'never'::text) AS detail FROM customers c LEFT JOIN properties p ON p.customer_id = c.id LEFT JOIN appointments a ON a.property_id = p.id AND a.status = 'completed'::text WHERE c.status = 'active'::customer_status GROUP BY c.id HAVING COALESCE(max(a.actual_arrival), '-infinity'::timestamp with time zone) < (now() - '60 days'::interval)`);

export const monthlyRevenue = pgView("monthly_revenue", {	month: timestamp({ withTimezone: true, mode: 'string' }),
	revenue: numeric(),
}).as(sql`SELECT date_trunc('month'::text, paid_at) AS month, sum(amount_cents)::numeric / 100.0 AS revenue FROM payments GROUP BY (date_trunc('month'::text, paid_at)) ORDER BY (date_trunc('month'::text, paid_at))`);

export const visitDurations = pgView("visit_durations", {	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	appointmentId: bigint("appointment_id", { mode: "number" }),
	customerCode: text("customer_code"),
	client: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	propertyId: bigint("property_id", { mode: "number" }),
	visitDate: date("visit_date"),
	actualArrival: timestamp("actual_arrival", { withTimezone: true, mode: 'string' }),
	actualDeparture: timestamp("actual_departure", { withTimezone: true, mode: 'string' }),
	// The times first booked, kept when GPS moves today's scheduled times to
	// when the crew actually arrived and left (lib/fleet/sync.ts).
	bookedStart: timestamp("booked_start", { withTimezone: true, mode: 'string' }),
	bookedEnd: timestamp("booked_end", { withTimezone: true, mode: 'string' }),
	onsiteMin: integer("onsite_min"),
	laborMin: integer("labor_min"),
	crew: text(),
	crewSize: smallint("crew_size"),
	priceCents: integer("price_cents"),
	actualSource: text("actual_source"),
}).as(sql`SELECT a.id AS appointment_id, c.customer_code, COALESCE(NULLIF(concat_ws(' '::text, c.first_name, c.last_name), ''::text), c.company_name) AS client, a.property_id, (a.actual_arrival AT TIME ZONE 'America/New_York'::text)::date AS visit_date, a.actual_arrival, a.actual_departure, round(EXTRACT(epoch FROM a.actual_departure - a.actual_arrival) / 60::numeric)::integer AS onsite_min, round(EXTRACT(epoch FROM a.actual_departure - a.actual_arrival) / 60::numeric * a.crew_size::numeric)::integer AS labor_min, a.crew, a.crew_size, a.price_cents, a.actual_source FROM appointments a JOIN properties p ON p.id = a.property_id JOIN customers c ON c.id = p.customer_id WHERE a.status = 'completed'::text AND a.actual_arrival IS NOT NULL AND a.actual_departure IS NOT NULL`);

export const clientTimeStats = pgView("client_time_stats", {	customerCode: text("customer_code"),
	client: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	propertyId: bigint("property_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	visits: bigint({ mode: "number" }),
	medianMin: integer("median_min"),
	avgMin: integer("avg_min"),
	minMin: integer("min_min"),
	maxMin: integer("max_min"),
	lastVisit: date("last_visit"),
	revenuePerOnsiteHr: numeric("revenue_per_onsite_hr"),
}).as(sql`SELECT customer_code, client, property_id, count(*) AS visits, percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (onsite_min::double precision))::integer AS median_min, round(avg(onsite_min))::integer AS avg_min, min(onsite_min) AS min_min, max(onsite_min) AS max_min, max(visit_date) AS last_visit, round(sum(price_cents) FILTER (WHERE price_cents > 0)::numeric / 100.0 / NULLIF(sum(onsite_min) FILTER (WHERE price_cents > 0), 0)::numeric * 60::numeric, 2) AS revenue_per_onsite_hr FROM visit_durations WHERE visit_date >= (CURRENT_DATE - 180) GROUP BY customer_code, client, property_id`);

export const houseProfitability = pgView("house_profitability", {	customerCode: text("customer_code"),
	client: text(),
	address: text(),
	zone: serviceZone(),
	frequency: frequency(),
	rate: numeric(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	visits: bigint({ mode: "number" }),
	medianMin: integer("median_min"),
	revenuePerHr: numeric("revenue_per_hr"),
	monthlyRevenue: numeric("monthly_revenue"),
}).as(sql`SELECT s.customer_code, s.client, concat_ws(', '::text, p.street, p.city) AS address, p.zone, sp.frequency, round(sp.rate_cents::numeric / 100.0, 2) AS rate, s.visits, s.median_min, round(sp.rate_cents::numeric / 100.0 / NULLIF(s.median_min, 0)::numeric * 60::numeric, 2) AS revenue_per_hr, round(sp.rate_cents::numeric / 100.0 * CASE sp.frequency WHEN 'weekly'::frequency THEN 52::numeric / 12.0 WHEN 'biweekly'::frequency THEN 26::numeric / 12.0 WHEN 'every_4_weeks'::frequency THEN 13::numeric / 12.0 WHEN 'monthly'::frequency THEN 1::numeric WHEN 'every_2_months'::frequency THEN 0.5 ELSE 0::numeric END, 2) AS monthly_revenue FROM client_time_stats s JOIN properties p ON p.id = s.property_id JOIN service_plans sp ON sp.property_id = s.property_id AND sp.end_date IS NULL ORDER BY (round(sp.rate_cents::numeric / 100.0 / NULLIF(s.median_min, 0)::numeric * 60::numeric, 2)) DESC`);
// Staff who can sign in. There's no public sign-up: accounts are created with
// `npm run users -- add`. Emails are stored lowercased so lookups are exact.
export const users = pgTable("users", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	email: text().notNull(),
	name: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	isDisabled: boolean("is_disabled").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Preferences, chosen on the settings page.
	theme: text({ enum: ["system", "light", "dark"] }).default('system').notNull(),
	locale: text({ enum: ["en-US", "pt-BR"] }).default('en-US').notNull(),
	// When the profile photo (user_avatars) last changed; null without one.
	// Part of the photo's URL so browsers fetch a new one after a change.
	avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true, mode: 'string' }),
	// What they may do: see lib/auth/permissions.ts.
	role: text({ enum: ["owner", "admin", "staff"] }).default('staff').notNull(),
	// Two-step login: the authenticator app's secret (encrypted with
	// AUTH_SECRET, lib/auth/crypto.ts), when it was turned on, and the last
	// 30-second step used so the same code can't be used twice.
	totpSecret: text("totp_secret"),
	totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true, mode: 'string' }),
	totpLastStep: bigint("totp_last_step", { mode: "number" }),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	// How they've arranged the dashboard's widgets (lib/dashboard/layout.ts);
	// null for the default.
	dashboardLayout: jsonb("dashboard_layout"),
}, (table) => [
	unique("users_email_key").on(table.email),
	check("users_role_check", sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])`),
	check("users_email_lower_check", sql`email = lower(email)`),
	check("users_theme_check", sql`theme = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text])`),
	check("users_locale_check", sql`locale = ANY (ARRAY['en-US'::text, 'pt-BR'::text])`),
]);

// Profile photos, kept out of the users table so ordinary user lookups don't
// load them. Stored as small WebP images (resized on upload).
export const userAvatars = pgTable("user_avatars", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).primaryKey().notNull(),
	image: bytea().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_avatars_user_id_fkey"
		}).onDelete("cascade"),
]);

// The session cookie holds a random token; only its SHA-256 hash is stored
// here, so a leaked database can't be used to sign in.
export const sessions = pgTable("sessions", {
	id: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sessions_user_id").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_fkey"
		}).onDelete("cascade"),
]);

// One-time recovery codes for two-step login (for a lost phone). Only a
// SHA-256 hash of each is stored; a used code is marked and never works again.
export const userRecoveryCodes = pgTable("user_recovery_codes", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	userId: bigint("user_id", { mode: "number" }).notNull(),
	codeHash: text("code_hash").notNull(),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("user_recovery_codes_user").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "user_recovery_codes_user_id_fkey" }).onDelete("cascade"),
]);

// The step between a correct password and a session: a short-lived token
// (hashed here, raw in a cookie) that lets the browser enter its two-step
// code, or set up two-step login for the first time ("enroll", holding the
// new secret until it's confirmed). Limited attempts.
export const loginChallenges = pgTable("login_challenges", {
	id: text().primaryKey().notNull(),
	userId: bigint("user_id", { mode: "number" }).notNull(),
	purpose: text({ enum: ["verify", "enroll"] }).notNull(),
	pendingSecret: text("pending_secret"),
	attempts: integer().default(0).notNull(),
	next: text(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("login_challenges_user").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "login_challenges_user_id_fkey" }).onDelete("cascade"),
	check("login_challenges_purpose_check", sql`purpose = ANY (ARRAY['verify'::text, 'enroll'::text])`),
]);

// Failed sign-ins, used to rate-limit password guessing by email and by IP.
export const loginAttempts = pgTable("login_attempts", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	email: text().notNull(),
	ip: text(),
	attemptedAt: timestamp("attempted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// password (sign-in), code (two-step) or reauth (password re-entered in
	// Settings); each is limited differently, see lib/auth/rate-limit.ts
	kind: text({ enum: ["password", "code", "reauth"] }).default('password').notNull(),
}, (table) => [
	index("login_attempts_email_at").using("btree", table.email.asc().nullsLast().op("text_ops"), table.attemptedAt.asc().nullsLast().op("timestamptz_ops")),
	check("login_attempts_kind_check", sql`kind = ANY (ARRAY['password'::text, 'code'::text, 'reauth'::text])`),
	index("login_attempts_ip_at").using("btree", table.ip.asc().nullsLast().op("text_ops"), table.attemptedAt.asc().nullsLast().op("timestamptz_ops")),
]);


// Company vehicles, assigned to appointments when they're booked. gps_name is
// the name the GPS tracker uses (gps_trips.vehicle / gps_stops.vehicle).
export const vehicles = pgTable("vehicles", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	plate: text(),
	gpsName: text("gps_name"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// The Bouncie device in this vehicle (its IMEI), linked on the Fleet page.
	bouncieImei: text("bouncie_imei"),
	// Latest readings from Bouncie, refreshed by lib/fleet/sync.ts.
	vin: text(),
	makeModel: text("make_model"),
	odometer: doublePrecision(),
	fuelLevel: doublePrecision("fuel_level"),
	isRunning: boolean("is_running"),
	speed: doublePrecision(),
	// { lat, lon, heading, address } of the last known position
	location: jsonb().$type<{ lat: number; lon: number; heading: number | null; address: string | null }>(),
	// check-engine light and its trouble codes ([{ code, name }])
	milOn: boolean("mil_on"),
	milCodes: jsonb("mil_codes").$type<{ code: string; name: string | null }[]>(),
	batteryStatus: text("battery_status", { enum: ["normal", "low", "critical"] }),
	statsUpdatedAt: timestamp("stats_updated_at", { withTimezone: true, mode: 'string' }),
	// last time the device lost power (unplugged or tampered with)
	unpluggedAt: timestamp("unplugged_at", { withTimezone: true, mode: 'string' }),
	// miles between routine services (oil change); see vehicle_service_records
	serviceIntervalMiles: integer("service_interval_miles").default(5000).notNull(),
}, (table) => [
	unique("vehicles_name_key").on(table.name),
	unique("vehicles_gps_name_key").on(table.gpsName),
	unique("vehicles_bouncie_imei_key").on(table.bouncieImei),
	check("vehicles_battery_status_check", sql`battery_status = ANY (ARRAY['normal'::text, 'low'::text, 'critical'::text])`),
	check("vehicles_service_interval_check", sql`service_interval_miles > 0`),
]);

// Trips reported by Bouncie (or the simulator in development), one row per
// trip. The start and end are matched to properties within ~200 m, which is
// how arrivals and departures at appointments are detected.
export const vehicleTrips = pgTable("vehicle_trips", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// Bouncie's unique id for the trip
	transactionId: text("transaction_id").notNull(),
	imei: text().notNull(),
	vehicleId: bigint("vehicle_id", { mode: "number" }),
	startAt: timestamp("start_at", { withTimezone: true, mode: 'string' }).notNull(),
	endAt: timestamp("end_at", { withTimezone: true, mode: 'string' }).notNull(),
	startOdometer: doublePrecision("start_odometer"),
	endOdometer: doublePrecision("end_odometer"),
	distanceMiles: doublePrecision("distance_miles").notNull(),
	fuelGallons: doublePrecision("fuel_gallons"),
	maxSpeed: doublePrecision("max_speed"),
	averageSpeed: doublePrecision("average_speed"),
	idleSeconds: integer("idle_seconds"),
	hardBraking: integer("hard_braking"),
	hardAcceleration: integer("hard_acceleration"),
	startLat: doublePrecision("start_lat"),
	startLng: doublePrecision("start_lng"),
	endLat: doublePrecision("end_lat"),
	endLng: doublePrecision("end_lng"),
	startPropertyId: bigint("start_property_id", { mode: "number" }),
	endPropertyId: bigint("end_property_id", { mode: "number" }),
	// GeoJSON LineString coordinates ([lon, lat] pairs) for drawing the route
	route: jsonb().$type<[number, number][]>(),
	// made up by the development simulator; removed when Bouncie is connected
	isSimulated: boolean("is_simulated").default(false).notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("vehicle_trips_transaction_id_key").on(table.transactionId),
	index("vehicle_trips_vehicle_start").using("btree", table.vehicleId.asc().nullsLast().op("int8_ops"), table.startAt.asc().nullsLast().op("timestamptz_ops")),
	index("vehicle_trips_start").using("btree", table.startAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({ columns: [table.vehicleId], foreignColumns: [vehicles.id], name: "vehicle_trips_vehicle_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.startPropertyId], foreignColumns: [properties.id], name: "vehicle_trips_start_property_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.endPropertyId], foreignColumns: [properties.id], name: "vehicle_trips_end_property_id_fkey" }).onDelete("set null"),
]);

// Routine services (oil changes etc.) recorded on the Fleet page. The latest
// one per vehicle plus its service interval gives the next one due.
export const vehicleServiceRecords = pgTable("vehicle_service_records", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	vehicleId: bigint("vehicle_id", { mode: "number" }).notNull(),
	performedOn: date("performed_on", { mode: 'string' }).notNull(),
	odometer: doublePrecision().notNull(),
	note: text(),
	createdBy: bigint("created_by", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("vehicle_service_records_vehicle").using("btree", table.vehicleId.asc().nullsLast().op("int8_ops"), table.performedOn.desc().nullsFirst().op("date_ops")),
	foreignKey({ columns: [table.vehicleId], foreignColumns: [vehicles.id], name: "vehicle_service_records_vehicle_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "vehicle_service_records_created_by_fkey" }),
]);

// Fleet sync state, a single row (id = 1): which source the data comes from,
// when it last synced, and a short lease so two page loads don't sync at once.
export const fleetSync = pgTable("fleet_sync", {
	id: smallint().primaryKey().notNull(),
	source: text({ enum: ["simulated", "bouncie"] }),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: 'string' }),
	// trips are fetched from here forward on the next sync
	tripsSyncedUntil: timestamp("trips_synced_until", { withTimezone: true, mode: 'string' }),
	lastError: text("last_error"),
	// every device on the account at the last sync, for linking them to vehicles
	devices: jsonb().$type<{ imei: string; nickName: string | null; vin: string | null; model: string | null }[]>(),
	leaseUntil: timestamp("lease_until", { withTimezone: true, mode: 'string' }),
}, () => [
	check("fleet_sync_single_row", sql`id = 1`),
	check("fleet_sync_source_check", sql`source = ANY (ARRAY['simulated'::text, 'bouncie'::text])`),
]);

// The connected Bouncie account's OAuth tokens, a single row (id = 1),
// encrypted with a key derived from BOUNCIE_CLIENT_SECRET (lib/bouncie/tokens.ts).
export const bouncieConnection = pgTable("bouncie_connection", {
	id: smallint().primaryKey().notNull(),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token").notNull(),
	// Bouncie's authorization codes don't expire; kept so a lapsed refresh
	// token can be replaced without asking to reconnect.
	authorizationCode: text("authorization_code").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	accountEmail: text("account_email"),
	connectedBy: bigint("connected_by", { mode: "number" }),
	connectedAt: timestamp("connected_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("bouncie_connection_single_row", sql`id = 1`),
	foreignKey({ columns: [table.connectedBy], foreignColumns: [users.id], name: "bouncie_connection_connected_by_fkey" }),
]);

// Change history, written by the audit_row trigger: one row per insert,
// update or delete, with only the changed fields ({"field": {"from", "to"}})
// for updates. changed_by is null for changes made outside the app.
export const auditLog = pgTable("audit_log", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	tableName: text("table_name").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rowId: bigint("row_id", { mode: "number" }).notNull(),
	// "view": someone saw or exported a tax ID or tax document
	action: text({ enum: ["insert", "update", "delete", "view"] }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	changedBy: bigint("changed_by", { mode: "number" }),
	changedAt: timestamp("changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	changes: jsonb().notNull(),
}, (table) => [
	index("audit_log_row").using("btree", table.tableName.asc().nullsLast().op("text_ops"), table.rowId.asc().nullsLast().op("int8_ops"), table.changedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.changedBy],
			foreignColumns: [users.id],
			name: "audit_log_changed_by_fkey"
		}),
	check("audit_log_action_check", sql`action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text, 'view'::text])`),
]);

// Invoices, mirrored from Stripe (the source of truth: numbering, payment,
// emails) and linked to our customers and properties. Kept current by
// lib/stripe-invoices.ts. customer_id is null for invoices whose Stripe
// customer isn't linked to anyone in the app yet.
export const invoices = pgTable("invoices", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	stripeInvoiceId: text("stripe_invoice_id").notNull(),
	// assigned by Stripe when the invoice is finalized; drafts have none
	number: text(),
	status: text({ enum: ["draft", "open", "paid", "void", "uncollectible"] }).notNull(),
	stripeCustomerId: text("stripe_customer_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	customerId: bigint("customer_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	propertyId: bigint("property_id", { mode: "number" }),
	// as printed on the invoice (Stripe's copy at finalization)
	customerName: text("customer_name"),
	customerEmail: text("customer_email"),
	customerAddress: jsonb("customer_address"),
	description: text(),
	currency: text().default('usd').notNull(),
	totalCents: integer("total_cents").notNull(),
	amountDueCents: integer("amount_due_cents").notNull(),
	amountPaidCents: integer("amount_paid_cents").notNull(),
	amountRemainingCents: integer("amount_remaining_cents").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	dueDate: timestamp("due_date", { withTimezone: true, mode: 'string' }),
	finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: 'string' }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
	// how a paid invoice was paid: through Stripe, or marked paid outside it
	// (cash/check when the app records it)
	paidVia: text("paid_via", { enum: ["stripe", "outside_stripe", "cash", "check", "other"] }),
	// what the app recorded for a payment outside Stripe, as typed: "Cash",
	// "Check #1042", "Zelle"
	paidViaNote: text("paid_via_note"),
	// the staff member who charged it or marked it paid in the app (also in
	// the Stripe invoice's metadata as collected_by / collected_by_user_id)
	paidByUserId: bigint("paid_by_user_id", { mode: "number" }),
	// the visit this invoice bills, when it was made from one (Stripe metadata
	// app_appointment_id); no foreign key, so a deleted visit leaves no error
	appointmentId: bigint("appointment_id", { mode: "number" }),
	hostedInvoiceUrl: text("hosted_invoice_url"),
	invoicePdfUrl: text("invoice_pdf_url"),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("invoices_stripe_invoice_id_key").on(table.stripeInvoiceId),
	index("invoices_customer_created").using("btree", table.customerId.asc().nullsLast().op("int8_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("invoices_status_created").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("invoices_appointment").using("btree", table.appointmentId.asc().nullsLast().op("int8_ops")),
	index("invoices_stripe_customer").using("btree", table.stripeCustomerId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.paidByUserId],
			foreignColumns: [users.id],
			name: "invoices_paid_by_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "invoices_customer_id_fkey"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "invoices_property_id_fkey"
		}).onDelete("set null"),
	check("invoices_status_check", sql`status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'void'::text, 'uncollectible'::text])`),
	check("invoices_paid_via_check", sql`paid_via = ANY (ARRAY['stripe'::text, 'outside_stripe'::text, 'cash'::text, 'check'::text, 'other'::text])`),
]);

// ---- Expenses ----
// The value lists (categories, payment methods, card brands, frequencies) are
// in lib/expenses/options.ts; the checks below must match them.
const CATEGORIES = sql.raw(`ARRAY['supplies','equipment','fuel','vehicle','insurance','wages','contractors','marketing','software','phone','rent','utilities','office','fees','taxes','professional','meals','travel','uniforms','training','other']::text[]`);
const PAYMENT_METHODS = sql.raw(`ARRAY['credit_card','debit_card','cash','check','bank_transfer','zelle','app','other']::text[]`);
const CARD_BRANDS = sql.raw(`ARRAY['amex','visa','mastercard','discover','other']::text[]`);

// Businesses and people we pay: Sam's Club, the insurance company, a
// contractor. Each has a code like customers do (V1000, V1001…).
export const vendors = pgTable("vendors", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	vendorCode: text("vendor_code").notNull(),
	name: text().notNull(),
	// filled in on new expenses for this vendor
	defaultCategory: text("default_category"),
	contactName: text("contact_name"),
	email: text(),
	phone: text(),
	website: text(),
	address: text(),
	// our account or customer number with them
	accountNumber: text("account_number"),
	notes: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	unique("vendors_vendor_code_key").on(table.vendorCode),
	// one vendor per name, so the same store isn't added twice
	uniqueIndex("vendors_name_key").using("btree", sql`lower(${table.name})`),
	check("vendors_vendor_code_check", sql`vendor_code ~ '^\\S+$'`),
	check("vendors_name_check", sql`btrim(name) <> ''`),
	check("vendors_default_category_check", sql`default_category = ANY (${CATEGORIES})`),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "vendors_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "vendors_updated_by_fkey" }),
]);

// Expenses that repeat (insurance, software, phone): what's expected and how
// often. Each payment is still recorded as an expense linked to its schedule.
export const recurringExpenses = pgTable("recurring_expenses", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	vendorId: bigint("vendor_id", { mode: "number" }).notNull(),
	category: text().notNull(),
	// the expected amount; for bills that vary (utilities), a typical amount
	amountCents: integer("amount_cents").notNull(),
	amountVaries: boolean("amount_varies").default(false).notNull(),
	frequency: text({ enum: ["weekly", "biweekly", "monthly", "quarterly", "yearly"] }).notNull(),
	// the first due date; later ones follow from the frequency
	startDate: date("start_date", { mode: 'string' }).notNull(),
	// the last day it applies (cancelled); null while it continues
	endDate: date("end_date", { mode: 'string' }),
	paymentMethod: text("payment_method").notNull(),
	cardBrand: text("card_brand"),
	cardLast4: text("card_last4"),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	index("recurring_expenses_vendor").using("btree", table.vendorId.asc().nullsLast().op("int8_ops")),
	check("recurring_expenses_category_check", sql`category = ANY (${CATEGORIES})`),
	check("recurring_expenses_amount_check", sql`amount_cents > 0 AND amount_cents <= 100000000`),
	check("recurring_expenses_frequency_check", sql`frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text])`),
	check("recurring_expenses_end_after_start_check", sql`end_date IS NULL OR end_date >= start_date`),
	check("recurring_expenses_payment_method_check", sql`payment_method = ANY (${PAYMENT_METHODS})`),
	check("recurring_expenses_card_brand_check", sql`card_brand = ANY (${CARD_BRANDS})`),
	check("recurring_expenses_card_last4_check", sql`card_last4 ~ '^\\d{4}$'`),
	foreignKey({ columns: [table.vendorId], foreignColumns: [vendors.id], name: "recurring_expenses_vendor_id_fkey" }),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "recurring_expenses_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "recurring_expenses_updated_by_fkey" }),
]);

// Money spent. created_by / updated_by are stamped by the database from the
// signed-in user (asUser in lib/db-helpers.ts), and every change is in the
// audit_log.
export const expenses = pgTable("expenses", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	expenseDate: date("expense_date", { mode: 'string' }).notNull(),
	vendorId: bigint("vendor_id", { mode: "number" }).notNull(),
	category: text().notNull(),
	amountCents: integer("amount_cents").notNull(),
	paymentMethod: text("payment_method").notNull(),
	cardBrand: text("card_brand"),
	cardLast4: text("card_last4"),
	// check number, confirmation number…
	reference: text(),
	description: text(),
	// the schedule this payment belongs to; null for one-time expenses
	recurringExpenseId: bigint("recurring_expense_id", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	index("expenses_date").using("btree", table.expenseDate.desc().nullsFirst().op("date_ops")),
	index("expenses_vendor_date").using("btree", table.vendorId.asc().nullsLast().op("int8_ops"), table.expenseDate.desc().nullsFirst().op("date_ops")),
	index("expenses_recurring").using("btree", table.recurringExpenseId.asc().nullsLast().op("int8_ops")),
	check("expenses_category_check", sql`category = ANY (${CATEGORIES})`),
	check("expenses_amount_check", sql`amount_cents > 0 AND amount_cents <= 100000000`),
	check("expenses_payment_method_check", sql`payment_method = ANY (${PAYMENT_METHODS})`),
	check("expenses_card_brand_check", sql`card_brand = ANY (${CARD_BRANDS})`),
	check("expenses_card_last4_check", sql`card_last4 ~ '^\\d{4}$'`),
	foreignKey({ columns: [table.vendorId], foreignColumns: [vendors.id], name: "expenses_vendor_id_fkey" }),
	foreignKey({ columns: [table.recurringExpenseId], foreignColumns: [recurringExpenses.id], name: "expenses_recurring_expense_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "expenses_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "expenses_updated_by_fkey" }),
]);

// Receipt photos and PDFs. Photos are re-encoded on upload (lib/receipts.ts),
// which also drops their location data; PDFs are kept as uploaded. Not in the
// audit_log: the files would be copied into it.
export const expenseReceipts = pgTable("expense_receipts", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	expenseId: bigint("expense_id", { mode: "number" }).notNull(),
	fileName: text("file_name").notNull(),
	contentType: text("content_type", { enum: ["image/webp", "application/pdf"] }).notNull(),
	sizeBytes: integer("size_bytes").notNull(),
	data: bytea().notNull(),
	uploadedBy: bigint("uploaded_by", { mode: "number" }),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("expense_receipts_expense").using("btree", table.expenseId.asc().nullsLast().op("int8_ops")),
	check("expense_receipts_content_type_check", sql`content_type = ANY (ARRAY['image/webp'::text, 'application/pdf'::text])`),
	foreignKey({ columns: [table.expenseId], foreignColumns: [expenses.id], name: "expense_receipts_expense_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.uploadedBy], foreignColumns: [users.id], name: "expense_receipts_uploaded_by_fkey" }).onDelete("set null"),
]);

// ---- Contractors (and their pay, tax IDs and documents) ----
// The cleaners, paid as independent contractors. Each has a vendor record:
// what they're paid is recorded as expenses to that vendor (category
// "contractors"), which is what the 1099-NEC totals come from.
export const contractors = pgTable("contractors", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	vendorId: bigint("vendor_id", { mode: "number" }).notNull(),
	// legal name, as on their W-9 and the 1099
	firstName: text("first_name").notNull(),
	lastName: text("last_name").notNull(),
	businessName: text("business_name"),
	email: text(),
	phone: text(),
	street: text(),
	city: text(),
	state: text(),
	zip: text(),
	// from the W-9: decides whether a 1099 is needed (corporations are exempt)
	taxClassification: text("tax_classification", { enum: ["individual", "llc_single", "partnership", "c_corp", "s_corp", "llc_partnership", "llc_c_corp", "llc_s_corp", "other"] }),
	// the tax ID itself is encrypted in contractor_tax_ids; only the type and
	// last 4 digits are kept here, for display
	tinType: text("tin_type", { enum: ["ssn", "ein"] }),
	tinLast4: text("tin_last4"),
	w9ReceivedOn: date("w9_received_on", { mode: 'string' }),
	startDate: date("start_date", { mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	unique("contractors_vendor_id_key").on(table.vendorId),
	check("contractors_name_check", sql`btrim(first_name) <> '' AND btrim(last_name) <> ''`),
	check("contractors_tax_classification_check", sql`tax_classification = ANY (ARRAY['individual','llc_single','partnership','c_corp','s_corp','llc_partnership','llc_c_corp','llc_s_corp','other']::text[])`),
	check("contractors_tin_type_check", sql`tin_type = ANY (ARRAY['ssn'::text, 'ein'::text])`),
	check("contractors_tin_last4_check", sql`tin_last4 ~ '^\\d{4}$'`),
	foreignKey({ columns: [table.vendorId], foreignColumns: [vendors.id], name: "contractors_vendor_id_fkey" }),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "contractors_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "contractors_updated_by_fkey" }),
]);

// Tax ID numbers (SSN or EIN), encrypted with a key derived from AUTH_SECRET
// (lib/auth/crypto.ts). Kept apart from contractors so ordinary queries never
// load them, and not in the audit_log (the log records who viewed or changed
// them, never the number).
export const contractorTaxIds = pgTable("contractor_tax_ids", {
	contractorId: bigint("contractor_id", { mode: "number" }).primaryKey().notNull(),
	tinEncrypted: text("tin_encrypted").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	foreignKey({ columns: [table.contractorId], foreignColumns: [contractors.id], name: "contractor_tax_ids_contractor_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "contractor_tax_ids_updated_by_fkey" }),
]);

// How a contractor is paid, from a date on. Changing the rate adds a row, so
// days already worked keep the rate they were worked at. A day rate for now;
// "percent" (a share of each cleaning's price) is ready for later.
export const contractorPayRates = pgTable("contractor_pay_rates", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	contractorId: bigint("contractor_id", { mode: "number" }).notNull(),
	effectiveFrom: date("effective_from", { mode: 'string' }).notNull(),
	payType: text("pay_type", { enum: ["day_rate", "percent"] }).notNull(),
	dayRateCents: integer("day_rate_cents"),
	// hundredths of a percent: 3500 = 35%
	percentBp: integer("percent_bp"),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	unique("contractor_pay_rates_contractor_from_key").on(table.contractorId, table.effectiveFrom),
	check("contractor_pay_rates_pay_type_check", sql`pay_type = ANY (ARRAY['day_rate'::text, 'percent'::text])`),
	check("contractor_pay_rates_amount_check", sql`(pay_type = 'day_rate' AND day_rate_cents > 0 AND day_rate_cents <= 1000000 AND percent_bp IS NULL) OR (pay_type = 'percent' AND percent_bp > 0 AND percent_bp <= 10000 AND day_rate_cents IS NULL)`),
	foreignKey({ columns: [table.contractorId], foreignColumns: [contractors.id], name: "contractor_pay_rates_contractor_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "contractor_pay_rates_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "contractor_pay_rates_updated_by_fkey" }),
]);

// Who cleaned on each appointment. A contractor worked a day when they're on
// a completed appointment that day.
// A customer's memorized (recurring) invoice, like NetSuite's memorized
// transactions: the invoice their recurring visits are billed with, and how
// often they come. Made from an accepted estimate's recurring plan, or set by
// hand from any invoice. One active per customer and property. Each visit
// gets a draft invoice made from it (Invoice & book); expected visits on the
// calendar come from it (lib/recurring).
export const memorizedInvoices = pgTable("memorized_invoices", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	customerId: bigint("customer_id", { mode: "number" }).notNull(),
	propertyId: bigint("property_id", { mode: "number" }),
	// how often: weekly, biweekly, every_3_weeks, every_4_weeks, or monthly
	// (the same week and weekday each month)
	frequency: text({ enum: ["weekly", "biweekly", "every_3_weeks", "every_4_weeks", "monthly"] }).notNull().default("biweekly"),
	// [{ description, cents }]
	lines: jsonb().notNull(),
	totalCents: integer("total_cents").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	// no expected visits before this day (a pause)
	pausedUntil: date("paused_until", { mode: "string" }),
	source: text({ enum: ["estimate", "invoice"] }).notNull(),
	sourceQuoteId: bigint("source_quote_id", { mode: "number" }),
	sourceInvoiceId: bigint("source_invoice_id", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	uniqueIndex("memorized_invoices_one_active").using("btree", table.customerId, sql`coalesce(${table.propertyId}, 0)`).where(sql`is_active`),
	check("memorized_invoices_frequency_check", sql`frequency in ('weekly', 'biweekly', 'every_3_weeks', 'every_4_weeks', 'monthly')`),
	foreignKey({ columns: [table.customerId], foreignColumns: [customers.id], name: "memorized_invoices_customer_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.propertyId], foreignColumns: [properties.id], name: "memorized_invoices_property_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "memorized_invoices_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "memorized_invoices_updated_by_fkey" }),
]);

// Expected visits someone skipped ("on vacation"): the schedule carries on
// from the skipped day as if it happened.
export const memorizedSkips = pgTable("memorized_skips", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	memorizedInvoiceId: bigint("memorized_invoice_id", { mode: "number" }).notNull(),
	day: date({ mode: "string" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
}, (table) => [
	unique("memorized_skips_key").on(table.memorizedInvoiceId, table.day),
	foreignKey({ columns: [table.memorizedInvoiceId], foreignColumns: [memorizedInvoices.id], name: "memorized_skips_memorized_invoice_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "memorized_skips_created_by_fkey" }),
]);

// The vehicles going to an appointment (one or more). appointments.vehicle_id
// stays the first of them: the "lead" vehicle GPS trips are matched against.
export const appointmentVehicles = pgTable("appointment_vehicles", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	appointmentId: bigint("appointment_id", { mode: "number" }).notNull(),
	vehicleId: bigint("vehicle_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	unique("appointment_vehicles_key").on(table.appointmentId, table.vehicleId),
	index("appointment_vehicles_vehicle").using("btree", table.vehicleId.asc().nullsLast().op("int8_ops")),
	foreignKey({ columns: [table.appointmentId], foreignColumns: [appointments.id], name: "appointment_vehicles_appointment_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.vehicleId], foreignColumns: [vehicles.id], name: "appointment_vehicles_vehicle_id_fkey" }),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "appointment_vehicles_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "appointment_vehicles_updated_by_fkey" }),
]);

export const appointmentContractors = pgTable("appointment_contractors", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	appointmentId: bigint("appointment_id", { mode: "number" }).notNull(),
	contractorId: bigint("contractor_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	unique("appointment_contractors_key").on(table.appointmentId, table.contractorId),
	index("appointment_contractors_contractor").using("btree", table.contractorId.asc().nullsLast().op("int8_ops")),
	foreignKey({ columns: [table.appointmentId], foreignColumns: [appointments.id], name: "appointment_contractors_appointment_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.contractorId], foreignColumns: [contractors.id], name: "appointment_contractors_contractor_id_fkey" }),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "appointment_contractors_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "appointment_contractors_updated_by_fkey" }),
]);

// W-9s, filed 1099s and other papers. A filed 1099 records the amount it
// reported, so a later change to that year's payments is flagged (a corrected
// 1099 may be needed). Not in the audit_log (the files would be copied in);
// uploads, views and deletions are logged by the app instead.
export const contractorDocuments = pgTable("contractor_documents", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	contractorId: bigint("contractor_id", { mode: "number" }).notNull(),
	kind: text({ enum: ["w9", "1099_nec", "other"] }).notNull(),
	taxYear: smallint("tax_year"),
	reportedCents: integer("reported_cents"),
	fileName: text("file_name").notNull(),
	contentType: text("content_type", { enum: ["image/webp", "application/pdf"] }).notNull(),
	sizeBytes: integer("size_bytes").notNull(),
	data: bytea().notNull(),
	uploadedBy: bigint("uploaded_by", { mode: "number" }),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("contractor_documents_contractor").using("btree", table.contractorId.asc().nullsLast().op("int8_ops")),
	check("contractor_documents_kind_check", sql`kind = ANY (ARRAY['w9'::text, '1099_nec'::text, 'other'::text])`),
	check("contractor_documents_content_type_check", sql`content_type = ANY (ARRAY['image/webp'::text, 'application/pdf'::text])`),
	check("contractor_documents_1099_year_check", sql`kind <> '1099_nec' OR (tax_year BETWEEN 2000 AND 2100 AND reported_cents >= 0)`),
	foreignKey({ columns: [table.contractorId], foreignColumns: [contractors.id], name: "contractor_documents_contractor_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.uploadedBy], foreignColumns: [users.id], name: "contractor_documents_uploaded_by_fkey" }).onDelete("set null"),
]);

// ---- Inventory ----
// Where things are: storage, each vehicle, and (for commercial work) client
// sites. report_token is the secret in the QR code cleaners scan to report a
// problem without signing in.
export const inventoryLocations = pgTable("inventory_locations", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	kind: text({ enum: ["storage", "vehicle", "site"] }).notNull(),
	name: text().notNull(),
	vehicleId: bigint("vehicle_id", { mode: "number" }),
	propertyId: bigint("property_id", { mode: "number" }),
	isActive: boolean("is_active").default(true).notNull(),
	reportToken: text("report_token").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	unique("inventory_locations_vehicle_id_key").on(table.vehicleId),
	unique("inventory_locations_report_token_key").on(table.reportToken),
	check("inventory_locations_kind_check", sql`kind = ANY (ARRAY['storage'::text, 'vehicle'::text, 'site'::text])`),
	check("inventory_locations_vehicle_check", sql`(kind = 'vehicle') = (vehicle_id IS NOT NULL)`),
	foreignKey({ columns: [table.vehicleId], foreignColumns: [vehicles.id], name: "inventory_locations_vehicle_id_fkey" }),
	foreignKey({ columns: [table.propertyId], foreignColumns: [properties.id], name: "inventory_locations_property_id_fkey" }),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "inventory_locations_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "inventory_locations_updated_by_fkey" }),
]);

// The catalog: what's stocked. Quantities are whole units (bottles, rolls,
// packs). vehicle_par is how many each vehicle should carry (its load-out);
// reorder_point is when storage is running low.
export const inventoryItems = pgTable("inventory_items", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	kind: text({ enum: ["supply", "reusable", "equipment"] }).notNull(),
	category: text().notNull(),
	unit: text().default('each').notNull(),
	sku: text(),
	vehiclePar: integer("vehicle_par").default(0).notNull(),
	reorderPoint: integer("reorder_point").default(0).notNull(),
	reorderQuantity: integer("reorder_quantity").default(0).notNull(),
	// what one unit costs, updated from the latest purchase
	unitCostCents: integer("unit_cost_cents"),
	preferredVendorId: bigint("preferred_vendor_id", { mode: "number" }),
	// equipment: routine service (filters, belts) and expected life
	serviceIntervalDays: integer("service_interval_days"),
	usefulLifeMonths: integer("useful_life_months"),
	notes: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	uniqueIndex("inventory_items_name_key").using("btree", sql`lower(${table.name})`),
	check("inventory_items_kind_check", sql`kind = ANY (ARRAY['supply'::text, 'reusable'::text, 'equipment'::text])`),
	check("inventory_items_category_check", sql`category = ANY (ARRAY['chemicals','paper','cloths','dusters','liners','ppe','tools','bottles','vacuums','machines','other']::text[])`),
	check("inventory_items_unit_check", sql`unit = ANY (ARRAY['each','bottle','gallon','roll','pack','box','case','pair','bag']::text[])`),
	check("inventory_items_amounts_check", sql`vehicle_par >= 0 AND reorder_point >= 0 AND reorder_quantity >= 0 AND (unit_cost_cents IS NULL OR unit_cost_cents >= 0)`),
	check("inventory_items_name_check", sql`btrim(name) <> ''`),
	foreignKey({ columns: [table.preferredVendorId], foreignColumns: [vendors.id], name: "inventory_items_preferred_vendor_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "inventory_items_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "inventory_items_updated_by_fkey" }),
]);

// How many of an item a specific location should hold, when it differs from
// the default (vehicles: the item's vehicle_par; others: none). For client
// sites' supply closets, and vehicles set up differently.
export const inventoryPars = pgTable("inventory_pars", {
	locationId: bigint("location_id", { mode: "number" }).notNull(),
	itemId: bigint("item_id", { mode: "number" }).notNull(),
	par: integer().notNull(),
}, (table) => [
	primaryKey({ columns: [table.locationId, table.itemId], name: "inventory_pars_pkey" }),
	check("inventory_pars_par_check", sql`par >= 0`),
	foreignKey({ columns: [table.locationId], foreignColumns: [inventoryLocations.id], name: "inventory_pars_location_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.itemId], foreignColumns: [inventoryItems.id], name: "inventory_pars_item_id_fkey" }).onDelete("cascade"),
]);

// Every change to stock, as a ledger: how much is where is the sum of what
// came in minus what went out. purchase: into a location (from an expense);
// transfer: between locations; use: consumed; write_off: lost, broken or
// worn out; adjust: a count found more (to) or fewer (from) than expected.
export const inventoryMovements = pgTable("inventory_movements", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	itemId: bigint("item_id", { mode: "number" }).notNull(),
	kind: text({ enum: ["purchase", "transfer", "use", "adjust", "write_off"] }).notNull(),
	quantity: integer().notNull(),
	fromLocationId: bigint("from_location_id", { mode: "number" }),
	toLocationId: bigint("to_location_id", { mode: "number" }),
	// the item's unit cost when this happened, for the cost of what was used
	unitCostCents: integer("unit_cost_cents"),
	expenseId: bigint("expense_id", { mode: "number" }),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	index("inventory_movements_item").using("btree", table.itemId.asc().nullsLast().op("int8_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("inventory_movements_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	check("inventory_movements_kind_check", sql`kind = ANY (ARRAY['purchase'::text, 'transfer'::text, 'use'::text, 'adjust'::text, 'write_off'::text])`),
	check("inventory_movements_quantity_check", sql`quantity > 0 AND quantity <= 100000`),
	check("inventory_movements_places_check", sql`CASE kind
		WHEN 'purchase' THEN from_location_id IS NULL AND to_location_id IS NOT NULL
		WHEN 'transfer' THEN from_location_id IS NOT NULL AND to_location_id IS NOT NULL AND from_location_id <> to_location_id
		WHEN 'adjust' THEN (from_location_id IS NULL) <> (to_location_id IS NULL)
		ELSE from_location_id IS NOT NULL AND to_location_id IS NULL END`),
	foreignKey({ columns: [table.itemId], foreignColumns: [inventoryItems.id], name: "inventory_movements_item_id_fkey" }),
	foreignKey({ columns: [table.fromLocationId], foreignColumns: [inventoryLocations.id], name: "inventory_movements_from_location_id_fkey" }),
	foreignKey({ columns: [table.toLocationId], foreignColumns: [inventoryLocations.id], name: "inventory_movements_to_location_id_fkey" }),
	foreignKey({ columns: [table.expenseId], foreignColumns: [expenses.id], name: "inventory_movements_expense_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "inventory_movements_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "inventory_movements_updated_by_fkey" }),
]);

// Equipment, one row per physical unit. Every asset is tied to the expense
// it was bought with (cost, vendor, receipt).
export const inventoryAssets = pgTable("inventory_assets", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	assetTag: text("asset_tag").notNull(),
	itemId: bigint("item_id", { mode: "number" }).notNull(),
	serialNumber: text("serial_number"),
	locationId: bigint("location_id", { mode: "number" }).notNull(),
	status: text({ enum: ["in_service", "needs_repair", "in_repair", "retired", "lost"] }).default('in_service').notNull(),
	expenseId: bigint("expense_id", { mode: "number" }).notNull(),
	purchaseCostCents: integer("purchase_cost_cents").notNull(),
	purchasedOn: date("purchased_on", { mode: 'string' }).notNull(),
	warrantyUntil: date("warranty_until", { mode: 'string' }),
	lastServicedOn: date("last_serviced_on", { mode: 'string' }),
	reportToken: text("report_token").notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	unique("inventory_assets_asset_tag_key").on(table.assetTag),
	unique("inventory_assets_report_token_key").on(table.reportToken),
	index("inventory_assets_location").using("btree", table.locationId.asc().nullsLast().op("int8_ops")),
	check("inventory_assets_status_check", sql`status = ANY (ARRAY['in_service'::text, 'needs_repair'::text, 'in_repair'::text, 'retired'::text, 'lost'::text])`),
	check("inventory_assets_cost_check", sql`purchase_cost_cents >= 0`),
	foreignKey({ columns: [table.itemId], foreignColumns: [inventoryItems.id], name: "inventory_assets_item_id_fkey" }),
	foreignKey({ columns: [table.locationId], foreignColumns: [inventoryLocations.id], name: "inventory_assets_location_id_fkey" }),
	foreignKey({ columns: [table.expenseId], foreignColumns: [expenses.id], name: "inventory_assets_expense_id_fkey" }),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "inventory_assets_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "inventory_assets_updated_by_fkey" }),
]);

// An asset's history: moves, status changes, service and repairs.
export const inventoryAssetEvents = pgTable("inventory_asset_events", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	assetId: bigint("asset_id", { mode: "number" }).notNull(),
	kind: text({ enum: ["added", "moved", "status", "serviced", "note"] }).notNull(),
	fromLocationId: bigint("from_location_id", { mode: "number" }),
	toLocationId: bigint("to_location_id", { mode: "number" }),
	status: text(),
	costCents: integer("cost_cents"),
	expenseId: bigint("expense_id", { mode: "number" }),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
}, (table) => [
	index("inventory_asset_events_asset").using("btree", table.assetId.asc().nullsLast().op("int8_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	check("inventory_asset_events_kind_check", sql`kind = ANY (ARRAY['added'::text, 'moved'::text, 'status'::text, 'serviced'::text, 'note'::text])`),
	foreignKey({ columns: [table.assetId], foreignColumns: [inventoryAssets.id], name: "inventory_asset_events_asset_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.fromLocationId], foreignColumns: [inventoryLocations.id], name: "inventory_asset_events_from_location_id_fkey" }),
	foreignKey({ columns: [table.toLocationId], foreignColumns: [inventoryLocations.id], name: "inventory_asset_events_to_location_id_fkey" }),
	foreignKey({ columns: [table.expenseId], foreignColumns: [expenses.id], name: "inventory_asset_events_expense_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "inventory_asset_events_created_by_fkey" }),
]);

// Problems reported by cleaners (in the app, or from a QR code without
// signing in): running low, out, broken, missing.
export const inventoryReports = pgTable("inventory_reports", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	kind: text({ enum: ["low", "out", "broken", "missing", "other"] }).notNull(),
	itemId: bigint("item_id", { mode: "number" }),
	assetId: bigint("asset_id", { mode: "number" }),
	locationId: bigint("location_id", { mode: "number" }),
	note: text(),
	reporterName: text("reporter_name"),
	reportedByUserId: bigint("reported_by_user_id", { mode: "number" }),
	contractorId: bigint("contractor_id", { mode: "number" }),
	source: text({ enum: ["app", "qr"] }).notNull(),
	// hashed with AUTH_SECRET, only to limit how often one device reports
	ipHash: text("ip_hash"),
	photo: bytea(),
	status: text({ enum: ["open", "resolved"] }).default('open').notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	resolvedBy: bigint("resolved_by", { mode: "number" }),
	resolution: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("inventory_reports_open").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	check("inventory_reports_kind_check", sql`kind = ANY (ARRAY['low'::text, 'out'::text, 'broken'::text, 'missing'::text, 'other'::text])`),
	check("inventory_reports_source_check", sql`source = ANY (ARRAY['app'::text, 'qr'::text])`),
	check("inventory_reports_status_check", sql`status = ANY (ARRAY['open'::text, 'resolved'::text])`),
	foreignKey({ columns: [table.itemId], foreignColumns: [inventoryItems.id], name: "inventory_reports_item_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.assetId], foreignColumns: [inventoryAssets.id], name: "inventory_reports_asset_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.locationId], foreignColumns: [inventoryLocations.id], name: "inventory_reports_location_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.reportedByUserId], foreignColumns: [users.id], name: "inventory_reports_reported_by_user_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.contractorId], foreignColumns: [contractors.id], name: "inventory_reports_contractor_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.resolvedBy], foreignColumns: [users.id], name: "inventory_reports_resolved_by_fkey" }).onDelete("set null"),
]);

// ---- Quotes (estimates) ----
// A quote for a customer or lead. The customer opens it with the link
// holding public_token and can accept it (quote_acceptances) or decline.
// Editing a sent quote bumps version, so an acceptance always names the
// exact version it accepted. Expired is worked out from valid_until.
export const quotes = pgTable("quotes", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	quoteNumber: integer("quote_number").notNull(),
	customerId: bigint("customer_id", { mode: "number" }).notNull(),
	propertyId: bigint("property_id", { mode: "number" }),
	content: jsonb().notNull(),
	version: integer().default(1).notNull(),
	status: text({ enum: ["draft", "sent", "accepted", "declined", "withdrawn"] }).default('draft').notNull(),
	validUntil: date("valid_until", { mode: 'string' }).notNull(),
	publicToken: text("public_token").notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	firstViewedAt: timestamp("first_viewed_at", { withTimezone: true, mode: 'string' }),
	lastViewedAt: timestamp("last_viewed_at", { withTimezone: true, mode: 'string' }),
	viewCount: integer("view_count").default(0).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	declinedAt: timestamp("declined_at", { withTimezone: true, mode: 'string' }),
	declineReason: text("decline_reason"),
	// the draft invoice made on acceptance, or why it couldn't be made
	invoiceId: bigint("invoice_id", { mode: "number" }),
	// a second draft invoice for one recurring visit, when the plan repeats
	recurringInvoiceId: bigint("recurring_invoice_id", { mode: "number" }),
	invoiceError: text("invoice_error"),
	// the first visit booked from the accepted quote
	appointmentId: bigint("appointment_id", { mode: "number" }),
	// wrong identity checks on the customer's page; locked for an hour after 5
	verifyFailures: integer("verify_failures").default(0).notNull(),
	verifyLockedUntil: timestamp("verify_locked_until", { withTimezone: true, mode: 'string' }),
	internalNotes: text("internal_notes"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	unique("quotes_quote_number_key").on(table.quoteNumber),
	unique("quotes_public_token_key").on(table.publicToken),
	index("quotes_customer").using("btree", table.customerId.asc().nullsLast().op("int8_ops")),
	index("quotes_status").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	check("quotes_status_check", sql`status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'withdrawn'::text])`),
	check("quotes_version_check", sql`version >= 1`),
	foreignKey({ columns: [table.customerId], foreignColumns: [customers.id], name: "quotes_customer_id_fkey" }),
	foreignKey({ columns: [table.propertyId], foreignColumns: [properties.id], name: "quotes_property_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.invoiceId], foreignColumns: [invoices.id], name: "quotes_invoice_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.recurringInvoiceId], foreignColumns: [invoices.id], name: "quotes_recurring_invoice_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.appointmentId], foreignColumns: [appointments.id], name: "quotes_appointment_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "quotes_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "quotes_updated_by_fkey" }),
]);

// The record of a customer accepting a quote online: who (the typed name,
// how their identity was checked), what (the option, add-ons, total, and a
// full copy of the quote with its SHA-256 fingerprint), the consent wording
// they agreed to, and when and from where. The database refuses to change or
// delete these rows.
export const quoteAcceptances = pgTable("quote_acceptances", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	quoteId: bigint("quote_id", { mode: "number" }).notNull(),
	quoteVersion: integer("quote_version").notNull(),
	optionId: text("option_id").notNull(),
	optionName: text("option_name").notNull(),
	addOnIds: text("add_on_ids").array().default(sql`'{}'::text[]`).notNull(),
	totalCents: integer("total_cents").notNull(),
	signerName: text("signer_name").notNull(),
	verifiedBy: text("verified_by", { enum: ["phone", "email", "none"] }).notNull(),
	consentVersion: text("consent_version").notNull(),
	consentText: text("consent_text").notNull(),
	snapshot: jsonb().notNull(),
	snapshotSha256: text("snapshot_sha256").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("quote_acceptances_quote_id_key").on(table.quoteId),
	check("quote_acceptances_verified_by_check", sql`verified_by = ANY (ARRAY['phone'::text, 'email'::text, 'none'::text])`),
	check("quote_acceptances_total_check", sql`total_cents >= 0`),
	foreignKey({ columns: [table.quoteId], foreignColumns: [quotes.id], name: "quote_acceptances_quote_id_fkey" }),
]);

// What happened to a quote, in order: created, sent, viewed, accepted…
export const quoteEvents = pgTable("quote_events", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	quoteId: bigint("quote_id", { mode: "number" }).notNull(),
	kind: text({ enum: ["created", "edited", "sent", "viewed", "verify_failed", "accepted", "declined", "withdrawn", "link_reset", "invoice_created", "invoice_failed", "scheduled", "reopened"] }).notNull(),
	detail: jsonb(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
}, (table) => [
	index("quote_events_quote").using("btree", table.quoteId.asc().nullsLast().op("int8_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({ columns: [table.quoteId], foreignColumns: [quotes.id], name: "quote_events_quote_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "quote_events_created_by_fkey" }).onDelete("set null"),
]);

// In-app notifications for staff (the bell in the header): a quote was
// accepted or declined, an invoice couldn't be made… Everyone signed in sees
// them; each person's reads are tracked separately.
export const notifications = pgTable("notifications", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	body: text(),
	href: text(),
	// who sees it: null for everyone, or one role (owner-only alerts)
	audience: text(),
	// the values for title and body's {placeholders}: they're stored in English
	// and translated when shown (lib/notifications.ts)
	vars: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("notifications_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	check("notifications_href_check", sql`href IS NULL OR href ~ '^/[^/]'`),
	check("notifications_audience_check", sql`audience IS NULL OR audience IN ('owner', 'admin', 'staff')`),
]);

export const notificationReads = pgTable("notification_reads", {
	notificationId: bigint("notification_id", { mode: "number" }).notNull(),
	userId: bigint("user_id", { mode: "number" }).notNull(),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.notificationId, table.userId], name: "notification_reads_pkey" }),
	foreignKey({ columns: [table.notificationId], foreignColumns: [notifications.id], name: "notification_reads_notification_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "notification_reads_user_id_fkey" }).onDelete("cascade"),
]);

// The price list behind quick estimates (lib/quotes/pricing.ts), one row.
// Until it's saved the first time, the built-in defaults are used.
export const priceLists = pgTable("price_lists", {
	id: smallint().primaryKey().notNull(),
	content: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: bigint("created_by", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	updatedBy: bigint("updated_by", { mode: "number" }),
}, (table) => [
	check("price_lists_single_row", sql`id = 1`),
	foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: "price_lists_created_by_fkey" }),
	foreignKey({ columns: [table.updatedBy], foreignColumns: [users.id], name: "price_lists_updated_by_fkey" }),
]);

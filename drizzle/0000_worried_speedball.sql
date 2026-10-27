-- The schema as it was before migrations were tracked (introspected by
-- drizzle-kit). Production had it already (scripts/migrate.ts records it as
-- applied there); a new database, like the demo's, is built from it.
CREATE TYPE "public"."customer_status" AS ENUM('lead', 'active', 'paused', 'lapsed', 'churned');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('residential', 'commercial', 'referral_partner');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('one_time', 'weekly', 'biweekly', 'every_4_weeks', 'monthly', 'every_2_months');--> statement-breakpoint
CREATE TYPE "public"."pay_method" AS ENUM('stripe', 'zelle_business', 'zelle_personal', 'venmo', 'check', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."service_zone" AS ENUM('south', 'northwest', 'city_core', 'north_northeast', 'other');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_code" text NOT NULL,
	"type" "customer_type" DEFAULT 'residential' NOT NULL,
	"status" "customer_status" DEFAULT 'lead' NOT NULL,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"email" text,
	"stripe_customer_id" text,
	"referred_by_id" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_customer_code_key" UNIQUE("customer_code"),
	CONSTRAINT "customers_stripe_customer_id_key" UNIQUE("stripe_customer_id"),
	CONSTRAINT "customers_check" CHECK ((first_name IS NOT NULL) OR (company_name IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"name" text,
	"role" text,
	"phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sms_opt_in" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"street" text NOT NULL,
	"unit" text,
	"city" text NOT NULL,
	"state" char(2) DEFAULT 'MD' NOT NULL,
	"zip" char(5) NOT NULL,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"zone" "service_zone",
	"access_notes" text,
	"service_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "properties_zip_check" CHECK (zip ~ '^\d{5}$'::text)
);
--> statement-breakpoint
CREATE TABLE "service_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"property_id" bigint NOT NULL,
	"frequency" "frequency" NOT NULL,
	"rate_cents" integer NOT NULL,
	"preferred_weekday" smallint,
	"weeks_of_month" smallint[],
	"default_payment_method" "pay_method",
	"stripe_subscription_id" text,
	"start_date" date DEFAULT CURRENT_DATE NOT NULL,
	"end_date" date,
	CONSTRAINT "service_plans_stripe_subscription_id_key" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "service_plans_rate_cents_check" CHECK (rate_cents >= 0),
	CONSTRAINT "service_plans_preferred_weekday_check" CHECK ((preferred_weekday >= 0) AND (preferred_weekday <= 6)),
	CONSTRAINT "service_plans_check" CHECK ((end_date IS NULL) OR (end_date >= start_date))
);
--> statement-breakpoint
CREATE TABLE "visit_history" (
	"customer_code" text,
	"visit_date" timestamp,
	"arrival" text,
	"departure" text,
	"calendar_label" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"appointment_id" bigint,
	"amount_cents" integer NOT NULL,
	"method" "pay_method" NOT NULL,
	"payer_name" text,
	"stripe_invoice_id" text,
	"paid_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payments_stripe_invoice_id_key" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"property_id" bigint NOT NULL,
	"service_plan_id" bigint,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone,
	"actual_arrival" timestamp with time zone,
	"actual_departure" timestamp with time zone,
	"crew" text,
	"price_cents" integer NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"gcal_event_id" text,
	"crew_size" smallint,
	"actual_source" text,
	CONSTRAINT "appointments_gcal_event_id_key" UNIQUE("gcal_event_id"),
	CONSTRAINT "appointments_status_check" CHECK (status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])),
	CONSTRAINT "appointments_crew_size_check" CHECK ((crew_size >= 1) AND (crew_size <= 6)),
	CONSTRAINT "appointments_actual_source_check" CHECK (actual_source = ANY (ARRAY['gps'::text, 'manual'::text, 'gcal_backfill'::text])),
	CONSTRAINT "actual_times_in_order" CHECK ((actual_arrival IS NULL) OR (actual_departure IS NULL) OR (actual_departure > actual_arrival))
);
--> statement-breakpoint
CREATE TABLE "gps_trips" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"start_address" text,
	"end_address" text,
	"end_lat" numeric(9, 6),
	"end_lng" numeric(9, 6),
	"miles" numeric(7, 2),
	"fuel_gal" numeric(6, 3),
	"source_file" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gps_trips_vehicle_started_at_key" UNIQUE("started_at","vehicle")
);
--> statement-breakpoint
CREATE TABLE "gps_stops" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle" text NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"departed_at" timestamp with time zone NOT NULL,
	"address" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"property_id" bigint,
	"appointment_id" bigint,
	"distance_m" integer,
	"confidence" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	CONSTRAINT "gps_stops_vehicle_arrived_at_key" UNIQUE("arrived_at","vehicle"),
	CONSTRAINT "gps_stops_confidence_check" CHECK (confidence = ANY (ARRAY['high'::text, 'medium'::text, 'review'::text, 'no_match'::text]))
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_plan_id_fkey" FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_stops" ADD CONSTRAINT "gps_stops_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_stops" ADD CONSTRAINT "gps_stops_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_phone" ON "contacts" USING btree ("phone" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "one_primary_contact" ON "contacts" USING btree ("customer_id" int8_ops) WHERE is_primary;--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_plan_per_property" ON "service_plans" USING btree ("property_id" int8_ops) WHERE (end_date IS NULL);--> statement-breakpoint
CREATE INDEX "payments_customer_paid" ON "payments" USING btree ("customer_id" int8_ops,"paid_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "appointments_property_start" ON "appointments" USING btree ("property_id" int8_ops,"scheduled_start" timestamptz_ops);--> statement-breakpoint
CREATE VIEW "public"."monthly_revenue" AS (SELECT date_trunc('month'::text, paid_at) AS month, sum(amount_cents)::numeric / 100.0 AS revenue FROM payments GROUP BY (date_trunc('month'::text, paid_at)) ORDER BY (date_trunc('month'::text, paid_at)));--> statement-breakpoint
CREATE VIEW "public"."visit_durations" AS (SELECT a.id AS appointment_id, c.customer_code, COALESCE(NULLIF(concat_ws(' '::text, c.first_name, c.last_name), ''::text), c.company_name) AS client, a.property_id, (a.actual_arrival AT TIME ZONE 'America/New_York'::text)::date AS visit_date, a.actual_arrival, a.actual_departure, round(EXTRACT(epoch FROM a.actual_departure - a.actual_arrival) / 60::numeric)::integer AS onsite_min, round(EXTRACT(epoch FROM a.actual_departure - a.actual_arrival) / 60::numeric * a.crew_size::numeric)::integer AS labor_min, a.crew, a.crew_size, a.price_cents, a.actual_source FROM appointments a JOIN properties p ON p.id = a.property_id JOIN customers c ON c.id = p.customer_id WHERE a.status = 'completed'::text AND a.actual_arrival IS NOT NULL AND a.actual_departure IS NOT NULL);--> statement-breakpoint
CREATE VIEW "public"."client_time_stats" AS (SELECT customer_code, client, property_id, count(*) AS visits, percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (onsite_min::double precision))::integer AS median_min, round(avg(onsite_min))::integer AS avg_min, min(onsite_min) AS min_min, max(onsite_min) AS max_min, max(visit_date) AS last_visit, round(sum(price_cents) FILTER (WHERE price_cents > 0)::numeric / 100.0 / NULLIF(sum(onsite_min) FILTER (WHERE price_cents > 0), 0)::numeric * 60::numeric, 2) AS revenue_per_onsite_hr FROM visit_durations WHERE visit_date >= (CURRENT_DATE - 180) GROUP BY customer_code, client, property_id);--> statement-breakpoint
CREATE VIEW "public"."house_profitability" AS (SELECT s.customer_code, s.client, concat_ws(', '::text, p.street, p.city) AS address, p.zone, sp.frequency, round(sp.rate_cents::numeric / 100.0, 2) AS rate, s.visits, s.median_min, round(sp.rate_cents::numeric / 100.0 / NULLIF(s.median_min, 0)::numeric * 60::numeric, 2) AS revenue_per_hr, round(sp.rate_cents::numeric / 100.0 * CASE sp.frequency WHEN 'weekly'::frequency THEN 52::numeric / 12.0 WHEN 'biweekly'::frequency THEN 26::numeric / 12.0 WHEN 'every_4_weeks'::frequency THEN 13::numeric / 12.0 WHEN 'monthly'::frequency THEN 1::numeric WHEN 'every_2_months'::frequency THEN 0.5 ELSE 0::numeric END, 2) AS monthly_revenue FROM client_time_stats s JOIN properties p ON p.id = s.property_id JOIN service_plans sp ON sp.property_id = s.property_id AND sp.end_date IS NULL ORDER BY (round(sp.rate_cents::numeric / 100.0 / NULLIF(s.median_min, 0)::numeric * 60::numeric, 2)) DESC);--> statement-breakpoint
CREATE VIEW "public"."data_issues" AS (SELECT 'no property'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, NULL::text AS detail FROM customers c WHERE c.status = 'active'::customer_status AND NOT (EXISTS ( SELECT 1 FROM properties p WHERE p.customer_id = c.id)) UNION ALL SELECT 'no service plan'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, p.street AS detail FROM properties p JOIN customers c ON c.id = p.customer_id WHERE p.is_active AND NOT (EXISTS ( SELECT 1 FROM service_plans sp WHERE sp.property_id = p.id AND sp.end_date IS NULL)) UNION ALL SELECT 'no primary phone'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, NULL::text AS detail FROM customers c WHERE c.status = 'active'::customer_status AND NOT (EXISTS ( SELECT 1 FROM contacts ct WHERE ct.customer_id = c.id AND ct.is_primary AND ct.phone IS NOT NULL)) UNION ALL SELECT 'shared phone'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, ct.phone AS detail FROM contacts ct JOIN customers c ON c.id = ct.customer_id WHERE (ct.phone IN ( SELECT contacts.phone FROM contacts WHERE contacts.phone IS NOT NULL GROUP BY contacts.phone HAVING count(DISTINCT contacts.customer_id) > 1)) UNION ALL SELECT 'shared address'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, p.street AS detail FROM properties p JOIN customers c ON c.id = p.customer_id WHERE (lower(p.street) IN ( SELECT lower(properties.street) AS lower FROM properties GROUP BY (lower(properties.street)) HAVING count(DISTINCT properties.customer_id) > 1)) UNION ALL SELECT 'visit priced $0'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text) AS detail FROM appointments a JOIN properties p ON p.id = a.property_id JOIN customers c ON c.id = p.customer_id WHERE a.status = 'completed'::text AND a.price_cents = 0 UNION ALL SELECT 'odd duration'::text AS issue, visit_durations.customer_code, visit_durations.client, ((visit_durations.visit_date || ': '::text) || visit_durations.onsite_min) || ' min'::text AS detail FROM visit_durations WHERE visit_durations.onsite_min < 30 OR visit_durations.onsite_min > 360 UNION ALL SELECT 'double-booked day'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text) AS detail FROM appointments a JOIN properties p ON p.id = a.property_id JOIN customers c ON c.id = p.customer_id WHERE a.status <> 'cancelled'::text GROUP BY c.customer_code, (concat_ws(' '::text, c.first_name, c.last_name, c.company_name)), a.property_id, (to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text)) HAVING count(*) > 1 UNION ALL SELECT 'active, no visit in 60 days'::text AS issue, c.customer_code, concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client, COALESCE('last: '::text || max((a.actual_arrival AT TIME ZONE 'America/New_York'::text)::date)::text, 'never'::text) AS detail FROM customers c LEFT JOIN properties p ON p.customer_id = c.id LEFT JOIN appointments a ON a.property_id = p.id AND a.status = 'completed'::text WHERE c.status = 'active'::customer_status GROUP BY c.id HAVING COALESCE(max(a.actual_arrival), '-infinity'::timestamp with time zone) < (now() - '60 days'::interval));

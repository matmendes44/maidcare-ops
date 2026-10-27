CREATE TABLE "bouncie_connection" (
	"id" smallint PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"authorization_code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"account_email" text,
	"connected_by" bigint,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bouncie_connection_single_row" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "fleet_sync" (
	"id" smallint PRIMARY KEY NOT NULL,
	"source" text,
	"last_synced_at" timestamp with time zone,
	"trips_synced_until" timestamp with time zone,
	"last_error" text,
	"devices" jsonb,
	"lease_until" timestamp with time zone,
	CONSTRAINT "fleet_sync_single_row" CHECK (id = 1),
	CONSTRAINT "fleet_sync_source_check" CHECK (source = ANY (ARRAY['simulated'::text, 'bouncie'::text]))
);
--> statement-breakpoint
CREATE TABLE "vehicle_service_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" bigint NOT NULL,
	"performed_on" date NOT NULL,
	"odometer" double precision NOT NULL,
	"note" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_trips" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"imei" text NOT NULL,
	"vehicle_id" bigint,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"start_odometer" double precision,
	"end_odometer" double precision,
	"distance_miles" double precision NOT NULL,
	"fuel_gallons" double precision,
	"max_speed" double precision,
	"average_speed" double precision,
	"idle_seconds" integer,
	"hard_braking" integer,
	"hard_acceleration" integer,
	"start_lat" double precision,
	"start_lng" double precision,
	"end_lat" double precision,
	"end_lng" double precision,
	"start_property_id" bigint,
	"end_property_id" bigint,
	"route" jsonb,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_trips_transaction_id_key" UNIQUE("transaction_id")
);
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_actual_source_check";--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "geocode_status" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "bouncie_imei" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "vin" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "make_model" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "odometer" double precision;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "fuel_level" double precision;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "is_running" boolean;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "speed" double precision;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "location" jsonb;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "mil_on" boolean;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "mil_codes" jsonb;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "battery_status" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "stats_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "unplugged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "service_interval_miles" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "bouncie_connection" ADD CONSTRAINT "bouncie_connection_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_service_records" ADD CONSTRAINT "vehicle_service_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_service_records" ADD CONSTRAINT "vehicle_service_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_start_property_id_fkey" FOREIGN KEY ("start_property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_end_property_id_fkey" FOREIGN KEY ("end_property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_service_records_vehicle" ON "vehicle_service_records" USING btree ("vehicle_id" int8_ops,"performed_on" date_ops);--> statement-breakpoint
CREATE INDEX "vehicle_trips_vehicle_start" ON "vehicle_trips" USING btree ("vehicle_id" int8_ops,"start_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "vehicle_trips_start" ON "vehicle_trips" USING btree ("start_at" timestamptz_ops);--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_bouncie_imei_key" UNIQUE("bouncie_imei");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_actual_source_check" CHECK (actual_source = ANY (ARRAY['gps'::text, 'gps_simulated'::text, 'manual'::text, 'gcal_backfill'::text]));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_geocode_status_check" CHECK (geocode_status = ANY (ARRAY['found'::text, 'not_found'::text]));--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_battery_status_check" CHECK (battery_status = ANY (ARRAY['normal'::text, 'low'::text, 'critical'::text]));--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_service_interval_check" CHECK (service_interval_miles > 0);--> statement-breakpoint
-- the single sync-state row
INSERT INTO "fleet_sync" ("id") VALUES (1) ON CONFLICT DO NOTHING;
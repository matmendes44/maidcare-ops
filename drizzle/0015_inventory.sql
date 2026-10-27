CREATE TABLE "inventory_asset_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"asset_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"from_location_id" bigint,
	"to_location_id" bigint,
	"status" text,
	"cost_cents" integer,
	"expense_id" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "inventory_asset_events_kind_check" CHECK (kind = ANY (ARRAY['added'::text, 'moved'::text, 'status'::text, 'serviced'::text, 'note'::text]))
);
--> statement-breakpoint
CREATE TABLE "inventory_assets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"asset_tag" text NOT NULL,
	"item_id" bigint NOT NULL,
	"serial_number" text,
	"location_id" bigint NOT NULL,
	"status" text DEFAULT 'in_service' NOT NULL,
	"expense_id" bigint NOT NULL,
	"purchase_cost_cents" integer NOT NULL,
	"purchased_on" date NOT NULL,
	"warranty_until" date,
	"last_serviced_on" date,
	"report_token" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "inventory_assets_asset_tag_key" UNIQUE("asset_tag"),
	CONSTRAINT "inventory_assets_report_token_key" UNIQUE("report_token"),
	CONSTRAINT "inventory_assets_status_check" CHECK (status = ANY (ARRAY['in_service'::text, 'needs_repair'::text, 'in_repair'::text, 'retired'::text, 'lost'::text])),
	CONSTRAINT "inventory_assets_cost_check" CHECK (purchase_cost_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"sku" text,
	"vehicle_par" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"reorder_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost_cents" integer,
	"preferred_vendor_id" bigint,
	"service_interval_days" integer,
	"useful_life_months" integer,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "inventory_items_kind_check" CHECK (kind = ANY (ARRAY['supply'::text, 'reusable'::text, 'equipment'::text])),
	CONSTRAINT "inventory_items_category_check" CHECK (category = ANY (ARRAY['chemicals','paper','cloths','dusters','liners','ppe','tools','bottles','vacuums','machines','other']::text[])),
	CONSTRAINT "inventory_items_unit_check" CHECK (unit = ANY (ARRAY['each','bottle','gallon','roll','pack','box','case','pair','bag']::text[])),
	CONSTRAINT "inventory_items_amounts_check" CHECK (vehicle_par >= 0 AND reorder_point >= 0 AND reorder_quantity >= 0 AND (unit_cost_cents IS NULL OR unit_cost_cents >= 0)),
	CONSTRAINT "inventory_items_name_check" CHECK (btrim(name) <> '')
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"vehicle_id" bigint,
	"property_id" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"report_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "inventory_locations_vehicle_id_key" UNIQUE("vehicle_id"),
	CONSTRAINT "inventory_locations_report_token_key" UNIQUE("report_token"),
	CONSTRAINT "inventory_locations_kind_check" CHECK (kind = ANY (ARRAY['storage'::text, 'vehicle'::text, 'site'::text])),
	CONSTRAINT "inventory_locations_vehicle_check" CHECK ((kind = 'vehicle') = (vehicle_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"from_location_id" bigint,
	"to_location_id" bigint,
	"unit_cost_cents" integer,
	"expense_id" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "inventory_movements_kind_check" CHECK (kind = ANY (ARRAY['purchase'::text, 'transfer'::text, 'use'::text, 'adjust'::text, 'write_off'::text])),
	CONSTRAINT "inventory_movements_quantity_check" CHECK (quantity > 0 AND quantity <= 100000),
	CONSTRAINT "inventory_movements_places_check" CHECK (CASE kind
		WHEN 'purchase' THEN from_location_id IS NULL AND to_location_id IS NOT NULL
		WHEN 'transfer' THEN from_location_id IS NOT NULL AND to_location_id IS NOT NULL AND from_location_id <> to_location_id
		WHEN 'adjust' THEN (from_location_id IS NULL) <> (to_location_id IS NULL)
		ELSE from_location_id IS NOT NULL AND to_location_id IS NULL END)
);
--> statement-breakpoint
CREATE TABLE "inventory_pars" (
	"location_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"par" integer NOT NULL,
	CONSTRAINT "inventory_pars_pkey" PRIMARY KEY("location_id","item_id"),
	CONSTRAINT "inventory_pars_par_check" CHECK (par >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"item_id" bigint,
	"asset_id" bigint,
	"location_id" bigint,
	"note" text,
	"reporter_name" text,
	"reported_by_user_id" bigint,
	"contractor_id" bigint,
	"source" text NOT NULL,
	"ip_hash" text,
	"photo" "bytea",
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" bigint,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reports_kind_check" CHECK (kind = ANY (ARRAY['low'::text, 'out'::text, 'broken'::text, 'missing'::text, 'other'::text])),
	CONSTRAINT "inventory_reports_source_check" CHECK (source = ANY (ARRAY['app'::text, 'qr'::text])),
	CONSTRAINT "inventory_reports_status_check" CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text]))
);
--> statement-breakpoint
ALTER TABLE "inventory_asset_events" ADD CONSTRAINT "inventory_asset_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."inventory_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_asset_events" ADD CONSTRAINT "inventory_asset_events_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_asset_events" ADD CONSTRAINT "inventory_asset_events_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_asset_events" ADD CONSTRAINT "inventory_asset_events_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_asset_events" ADD CONSTRAINT "inventory_asset_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_preferred_vendor_id_fkey" FOREIGN KEY ("preferred_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_pars" ADD CONSTRAINT "inventory_pars_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_pars" ADD CONSTRAINT "inventory_pars_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reports" ADD CONSTRAINT "inventory_reports_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reports" ADD CONSTRAINT "inventory_reports_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."inventory_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reports" ADD CONSTRAINT "inventory_reports_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reports" ADD CONSTRAINT "inventory_reports_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reports" ADD CONSTRAINT "inventory_reports_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reports" ADD CONSTRAINT "inventory_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_asset_events_asset" ON "inventory_asset_events" USING btree ("asset_id" int8_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "inventory_assets_location" ON "inventory_assets" USING btree ("location_id" int8_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_name_key" ON "inventory_items" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "inventory_movements_item" ON "inventory_movements" USING btree ("item_id" int8_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "inventory_movements_created" ON "inventory_movements" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "inventory_reports_open" ON "inventory_reports" USING btree ("status" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
-- Who created and last changed each row, and the change history. Reports
-- aren't audited by trigger (photos would be copied into the log).
CREATE TRIGGER "inventory_locations_stamp" BEFORE INSERT OR UPDATE ON "inventory_locations"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "inventory_locations_audit" AFTER INSERT OR UPDATE OR DELETE ON "inventory_locations"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
CREATE TRIGGER "inventory_items_stamp" BEFORE INSERT OR UPDATE ON "inventory_items"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "inventory_items_audit" AFTER INSERT OR UPDATE OR DELETE ON "inventory_items"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
CREATE TRIGGER "inventory_movements_stamp" BEFORE INSERT OR UPDATE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "inventory_movements_audit" AFTER INSERT OR UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
CREATE TRIGGER "inventory_assets_stamp" BEFORE INSERT OR UPDATE ON "inventory_assets"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "inventory_assets_audit" AFTER INSERT OR UPDATE OR DELETE ON "inventory_assets"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
-- A storage location to start with, and one for each vehicle. QR tokens are
-- 64 hex characters from gen_random_uuid() (a strong random source).
INSERT INTO "inventory_locations" ("kind", "name", "report_token")
VALUES ('storage', 'Main storage', encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'));--> statement-breakpoint
INSERT INTO "inventory_locations" ("kind", "name", "vehicle_id", "is_active", "report_token")
SELECT 'vehicle', v.name, v.id, v.is_active, encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex')
  FROM vehicles v;

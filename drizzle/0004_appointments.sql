-- Hand-written: drizzle-kit can't express the exclusion constraint, the
-- triggers, the status data change or the data_issues view rewrite.
--
-- 1. Vehicles.
CREATE TABLE "vehicles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plate" text,
	"gps_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_name_key" UNIQUE("name"),
	CONSTRAINT "vehicles_gps_name_key" UNIQUE("gps_name")
);--> statement-breakpoint
-- 2. Statuses become pending / completed / canceled.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_status_check";--> statement-breakpoint
UPDATE "appointments" SET "status" = CASE "status"
  WHEN 'scheduled' THEN 'pending'
  WHEN 'cancelled' THEN 'canceled'
  WHEN 'no_show' THEN 'canceled'
  ELSE "status" END;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'canceled'::text]));--> statement-breakpoint
-- data_issues compared against the old 'cancelled' spelling (otherwise unchanged).
CREATE OR REPLACE VIEW "public"."data_issues" AS
SELECT 'no property'::text AS issue,
    c.customer_code,
    concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client,
    NULL::text AS detail
   FROM customers c
  WHERE c.status = 'active'::customer_status AND NOT (EXISTS ( SELECT 1
           FROM properties p
          WHERE p.customer_id = c.id))
UNION ALL
 SELECT 'no service plan'::text AS issue,
    c.customer_code,
    concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client,
    p.street AS detail
   FROM properties p
     JOIN customers c ON c.id = p.customer_id
  WHERE p.is_active AND NOT (EXISTS ( SELECT 1
           FROM service_plans sp
          WHERE sp.property_id = p.id AND sp.end_date IS NULL))
UNION ALL
 SELECT 'no primary phone'::text AS issue,
    c.customer_code,
    concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client,
    NULL::text AS detail
   FROM customers c
  WHERE c.status = 'active'::customer_status AND NOT (EXISTS ( SELECT 1
           FROM contacts ct
          WHERE ct.customer_id = c.id AND ct.is_primary AND ct.phone IS NOT NULL))
UNION ALL
 SELECT 'shared phone'::text AS issue,
    c.customer_code,
    concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client,
    ct.phone AS detail
   FROM contacts ct
     JOIN customers c ON c.id = ct.customer_id
  WHERE (ct.phone IN ( SELECT contacts.phone
           FROM contacts
          WHERE contacts.phone IS NOT NULL
          GROUP BY contacts.phone
         HAVING count(DISTINCT contacts.customer_id) > 1))
UNION ALL
 SELECT 'shared address'::text AS issue,
    c.customer_code,
    concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client,
    p.street AS detail
   FROM properties p
     JOIN customers c ON c.id = p.customer_id
  WHERE (lower(p.street) IN ( SELECT lower(properties.street) AS lower
           FROM properties
          GROUP BY (lower(properties.street))
         HAVING count(DISTINCT properties.customer_id) > 1))
UNION ALL
 SELECT 'visit priced $0'::text AS issue,
    c.customer_code,
    concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client,
    to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text) AS detail
   FROM appointments a
     JOIN properties p ON p.id = a.property_id
     JOIN customers c ON c.id = p.customer_id
  WHERE a.status = 'completed'::text AND a.price_cents = 0
UNION ALL
 SELECT 'odd duration'::text AS issue,
    visit_durations.customer_code,
    visit_durations.client,
    ((visit_durations.visit_date || ': '::text) || visit_durations.onsite_min) || ' min'::text AS detail
   FROM visit_durations
  WHERE visit_durations.onsite_min < 30 OR visit_durations.onsite_min > 360
UNION ALL
 SELECT 'double-booked day'::text AS issue,
    c.customer_code,
    concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client,
    to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text) AS detail
   FROM appointments a
     JOIN properties p ON p.id = a.property_id
     JOIN customers c ON c.id = p.customer_id
  WHERE a.status <> 'canceled'::text
  GROUP BY c.customer_code, (concat_ws(' '::text, c.first_name, c.last_name, c.company_name)), a.property_id, (to_char((a.scheduled_start AT TIME ZONE 'America/New_York'::text), 'MM/DD/YYYY'::text))
 HAVING count(*) > 1
UNION ALL
 SELECT 'active, no visit in 60 days'::text AS issue,
    c.customer_code,
    concat_ws(' '::text, c.first_name, c.last_name, c.company_name) AS client,
    COALESCE('last: '::text || max((a.actual_arrival AT TIME ZONE 'America/New_York'::text)::date)::text, 'never'::text) AS detail
   FROM customers c
     LEFT JOIN properties p ON p.customer_id = c.id
     LEFT JOIN appointments a ON a.property_id = p.id AND a.status = 'completed'::text
  WHERE c.status = 'active'::customer_status
  GROUP BY c.id
 HAVING COALESCE(max(a.actual_arrival), '-infinity'::timestamp with time zone) < (now() - '60 days'::interval);--> statement-breakpoint
-- 3. The customer each appointment is for; existing ones get the property's
-- current owner.
ALTER TABLE "appointments" ADD COLUMN "customer_id" bigint;--> statement-breakpoint
UPDATE "appointments" a SET "customer_id" = p.customer_id FROM properties p WHERE p.id = a.property_id;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "customer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");--> statement-breakpoint
CREATE INDEX "appointments_customer_start" ON "appointments" USING btree ("customer_id" int8_ops,"scheduled_start" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "appointments_start" ON "appointments" USING btree ("scheduled_start" timestamptz_ops);--> statement-breakpoint
-- 4. Times: an end is required and comes after the start.
ALTER TABLE "appointments" ALTER COLUMN "scheduled_end" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_end_after_start_check" CHECK (scheduled_end > scheduled_start);--> statement-breakpoint
-- 5. Vehicle, which can't be booked for two overlapping appointments.
ALTER TABLE "appointments" ADD COLUMN "vehicle_id" bigint;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_no_overlap" EXCLUDE USING gist ("vehicle_id" WITH =, tstzrange("scheduled_start", "scheduled_end") WITH &&) WHERE (status <> 'canceled');--> statement-breakpoint
-- 6. Notes and system information. Existing rows predate tracking, so their
-- created_at stays empty.
ALTER TABLE "appointments" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "updated_by" bigint;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");--> statement-breakpoint
-- The app says who is acting with set_config('app.user_id', …, true) at the
-- start of each write's transaction (lib/db-helpers.ts). Empty outside the app.
CREATE FUNCTION "app_user_id"() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::bigint
$$;--> statement-breakpoint
CREATE FUNCTION "stamp_appointment"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := coalesce(NEW.created_at, now());
    NEW.created_by := coalesce(NEW.created_by, app_user_id());
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := app_user_id();
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "appointments_stamp" BEFORE INSERT OR UPDATE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
-- 7. Change history.
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"row_id" bigint NOT NULL,
	"action" text NOT NULL,
	"changed_by" bigint,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "audit_log_action_check" CHECK (action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))
);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "audit_log_row" ON "audit_log" USING btree ("table_name" text_ops,"row_id" int8_ops,"changed_at" timestamptz_ops);--> statement-breakpoint
-- Records the whole row on insert/delete, and only the fields that changed
-- (as {"field": {"from": …, "to": …}}) on update. Bookkeeping columns are
-- left out; an update that changes nothing else isn't logged.
CREATE FUNCTION "audit_row"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  diff jsonb;
  row_id bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    row_id := NEW.id;
    diff := to_jsonb(NEW) - 'created_at' - 'created_by' - 'updated_at' - 'updated_by';
  ELSIF TG_OP = 'DELETE' THEN
    row_id := OLD.id;
    diff := to_jsonb(OLD) - 'created_at' - 'created_by' - 'updated_at' - 'updated_by';
  ELSE
    row_id := NEW.id;
    SELECT jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      INTO diff
      FROM jsonb_each(to_jsonb(NEW)) n
      JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value
       AND n.key NOT IN ('created_at', 'created_by', 'updated_at', 'updated_by');
    IF diff IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO audit_log (table_name, row_id, action, changed_by, changes)
  VALUES (TG_TABLE_NAME, row_id, lower(TG_OP), app_user_id(), diff);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "appointments_audit" AFTER INSERT OR UPDATE OR DELETE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION audit_row();

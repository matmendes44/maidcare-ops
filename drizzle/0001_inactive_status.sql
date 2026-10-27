-- Hand-written: replaces the drizzle-kit output, which can't handle the
-- data_issues view that depends on customers.status, nor move existing rows.
--
-- 1. Customer start/end dates and reasons for leaving.
CREATE TYPE "public"."end_reason" AS ENUM('quality', 'scheduling_communication', 'client_circumstances');--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "end_reasons" "end_reason"[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Start date: the earliest of first completed visit, first service plan, or
-- when the record was created.
UPDATE "customers" c SET "start_date" = LEAST(
  c.created_at::date,
  (SELECT min((a.scheduled_start AT TIME ZONE 'America/New_York')::date)
     FROM appointments a JOIN properties p ON p.id = a.property_id
    WHERE p.customer_id = c.id AND a.status = 'completed'),
  (SELECT min(sp.start_date)
     FROM service_plans sp JOIN properties p ON p.id = sp.property_id
    WHERE p.customer_id = c.id)
);--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "start_date" SET DEFAULT CURRENT_DATE;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "start_date" SET NOT NULL;--> statement-breakpoint
-- End date for customers who left: last completed visit, else when their
-- service plan ended, else when the record was last changed.
UPDATE "customers" c SET "end_date" = GREATEST(c.start_date, COALESCE(
  (SELECT max((a.scheduled_start AT TIME ZONE 'America/New_York')::date)
     FROM appointments a JOIN properties p ON p.id = a.property_id
    WHERE p.customer_id = c.id AND a.status = 'completed'),
  (SELECT max(sp.end_date)
     FROM service_plans sp JOIN properties p ON p.id = sp.property_id
    WHERE p.customer_id = c.id),
  c.updated_at::date
))
WHERE c.status IN ('lapsed', 'churned');--> statement-breakpoint
-- 2. Replace lapsed + churned with inactive. Postgres can't drop enum values,
-- so the type is rebuilt; data_issues reads customers.status and must be
-- dropped and recreated around the change (definition unchanged).
DROP VIEW "public"."data_issues";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."customer_status" RENAME TO "customer_status_old";--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('lead', 'active', 'paused', 'inactive');--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" SET DATA TYPE "public"."customer_status" USING (
  CASE WHEN "status"::text IN ('lapsed', 'churned') THEN 'inactive' ELSE "status"::text END
)::"public"."customer_status";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" SET DEFAULT 'lead'::"public"."customer_status";--> statement-breakpoint
DROP TYPE "public"."customer_status_old";--> statement-breakpoint
CREATE VIEW "public"."data_issues" AS
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
  WHERE a.status <> 'cancelled'::text
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
-- 3. Inactive customers always have an end date, and only they have one.
ALTER TABLE "customers" ADD CONSTRAINT "customers_end_date_status_check" CHECK ((status = 'inactive'::customer_status) = (end_date IS NOT NULL));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_end_after_start_check" CHECK ((end_date IS NULL) OR (end_date >= start_date));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_end_reasons_status_check" CHECK ((status = 'inactive'::customer_status) OR (cardinality(end_reasons) = 0));

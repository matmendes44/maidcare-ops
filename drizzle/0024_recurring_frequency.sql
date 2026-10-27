ALTER TABLE "memorized_invoices" ADD COLUMN "frequency" text DEFAULT 'biweekly' NOT NULL;--> statement-breakpoint
-- from the number of days it used to keep
UPDATE "memorized_invoices" SET "frequency" = CASE "interval_days" WHEN 7 THEN 'weekly' WHEN 21 THEN 'every_3_weeks' WHEN 28 THEN 'every_4_weeks' ELSE 'biweekly' END;

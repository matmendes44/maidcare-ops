-- Estimates are built from the price list now; templates are gone.
ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_template_id_fkey";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN IF EXISTS "template_id";--> statement-breakpoint
DROP TABLE IF EXISTS "quote_templates";

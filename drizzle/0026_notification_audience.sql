ALTER TABLE "notifications" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_audience_check" CHECK (audience IS NULL OR audience IN ('owner', 'admin', 'staff'));--> statement-breakpoint
UPDATE "notifications" SET "audience" = 'owner' WHERE "kind" = 'invoice_to_finalize';

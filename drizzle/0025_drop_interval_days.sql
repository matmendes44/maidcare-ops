ALTER TABLE "memorized_invoices" DROP CONSTRAINT "memorized_invoices_interval_check";--> statement-breakpoint
ALTER TABLE "memorized_invoices" DROP COLUMN "interval_days";--> statement-breakpoint
ALTER TABLE "memorized_invoices" ADD CONSTRAINT "memorized_invoices_frequency_check" CHECK (frequency in ('weekly', 'biweekly', 'every_3_weeks', 'every_4_weeks', 'monthly'));
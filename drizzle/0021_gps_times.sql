ALTER TABLE "appointments" ADD COLUMN "booked_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "booked_end" timestamp with time zone;--> statement-breakpoint
-- GPS moves today's times as the crew works through the day (in any order),
-- which can overlap for a moment; booking still checks vehicles in the app.
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_vehicle_no_overlap";

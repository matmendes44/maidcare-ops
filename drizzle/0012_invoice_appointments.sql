ALTER TABLE "invoices" ADD COLUMN "appointment_id" bigint;--> statement-breakpoint
CREATE INDEX "invoices_appointment" ON "invoices" USING btree ("appointment_id" int8_ops);